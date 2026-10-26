"""Form D sync: backfill bulk quarters not yet loaded, then catch up via daily indexes.

Safe to run repeatedly (Railway cron): every step is recorded in ingest_state and every
write is an upsert, so a crashed or overlapping run just redoes work.
"""

import logging
from datetime import date, timedelta

import psycopg

from . import db
from .sec_client import NotFound, SecClient
from .sources import formd

log = logging.getLogger(__name__)

BULK_SOURCE = "formd_bulk"
DAILY_SOURCE = "formd_daily"


def parse_quarter(s: str) -> tuple[int, int]:
    year, q = s.lower().split("q")
    return int(year), int(q)


def quarter_of(d: date) -> tuple[int, int]:
    return d.year, (d.month - 1) // 3 + 1


def quarters_between(start: tuple[int, int], end: tuple[int, int]) -> list[tuple[int, int]]:
    out, (y, q) = [], start
    while (y, q) <= end:
        out.append((y, q))
        y, q = (y + 1, 1) if q == 4 else (y, q + 1)
    return out


def quarter_end(y: int, q: int) -> date:
    return (date(y + 1, 1, 1) if q == 4 else date(y, 3 * q + 1, 1)) - timedelta(days=1)


def ingest_quarter(conn: psycopg.Connection, sec: SecClient, y: int, q: int) -> int | None:
    """Returns number of kept filings, or None if SEC hasn't published this quarter yet."""
    url = formd.quarter_url(y, q)
    try:
        data = sec.get(url).content
    except NotFound:
        return None
    filings = formd.parse_bulk_zip(data)
    for f in filings:
        db.upsert_filing(conn, f)
    db.mark(conn, BULK_SOURCE, f"{y}q{q}", "done", {"kept": len(filings), "url": url})
    conn.commit()
    return len(filings)


def ingest_day(conn: psycopg.Connection, sec: SecClient, day: date) -> int | None:
    """Returns kept filings for the day, or None if there is no index (weekend/holiday/not yet posted)."""
    try:
        text = sec.get(formd.daily_index_url(day)).text
    except NotFound:
        return None
    kept = 0
    entries = formd.parse_master_index(text)
    for entry in entries:
        try:
            xml = sec.get(entry.primary_doc_url).content
            filing = formd.parse_primary_doc(xml, entry)
        except NotFound:
            log.warning("no primary_doc.xml for %s", entry.accession_number)
            continue
        except Exception:
            log.exception("failed to parse %s", entry.accession_number)
            continue
        if filing is not None:
            db.upsert_filing(conn, filing)
            kept += 1
    db.mark(conn, DAILY_SOURCE, day.isoformat(), "done", {"form_d": len(entries), "kept": kept})
    conn.commit()
    return kept


def sync(conn: psycopg.Connection, sec: SecClient, backfill_from: str, today: date | None = None,
         max_quarters: int | None = None) -> dict:
    today = today or date.today()
    done = db.done_keys(conn, BULK_SOURCE)
    current = quarter_of(today)
    loaded_through: date | None = None
    stats = {"quarters": {}, "days": {}}

    # The bulk set for the running quarter never exists yet.
    pending = [yq for yq in quarters_between(parse_quarter(backfill_from), current)
               if yq != current and f"{yq[0]}q{yq[1]}" not in done]
    deferred = []
    if max_quarters is not None:
        pending, deferred = pending[:max_quarters], pending[max_quarters:]
    for y, q in pending:
        n = ingest_quarter(conn, sec, y, q)
        log.info("bulk %sq%s: %s", y, q, "not published yet" if n is None else f"{n} VC/FoF filings")
        stats["quarters"][f"{y}q{q}"] = n
    if deferred:
        log.info("%d bulk quarters left for later runs; skipping daily catch-up", len(deferred))
        return stats

    # Daily indexes cover everything after the last published bulk quarter.
    done = db.done_keys(conn, BULK_SOURCE)
    if done:
        loaded_through = max(quarter_end(*parse_quarter(k)) for k in done)
    by, bq = parse_quarter(backfill_from)
    start = (loaded_through + timedelta(days=1)) if loaded_through else date(by, 3 * bq - 2, 1)
    days_done = db.done_keys(conn, DAILY_SOURCE)
    day = start
    while day < today:  # today's index is posted after close; picked up next run
        if day.weekday() < 5 and day.isoformat() not in days_done:
            n = ingest_day(conn, sec, day)
            log.info("daily %s: %s", day, "no index" if n is None else f"{n} VC/FoF filings")
            stats["days"][day.isoformat()] = n
        day += timedelta(days=1)
    return stats


def status(conn: psycopg.Connection) -> dict:
    row = conn.execute(
        """
        SELECT
          (SELECT count(*) FROM entities WHERE type = 'vc_fund'),
          (SELECT count(*) FROM entities WHERE type = 'fof'),
          (SELECT count(*) FROM formd_filings),
          (SELECT count(*) FROM people),
          (SELECT count(*) FROM roles),
          (SELECT max(filed_at) FROM formd_filings),
          (SELECT count(*) FROM ingest_state WHERE source = %s AND status = 'done'),
          (SELECT max(key) FROM ingest_state WHERE source = %s AND status = 'done')
        """,
        (BULK_SOURCE, DAILY_SOURCE),
    ).fetchone()
    keys = ["vc_funds", "fofs", "filings", "people", "roles", "latest_filing", "bulk_quarters_done",
            "latest_daily_index"]
    return dict(zip(keys, row))
