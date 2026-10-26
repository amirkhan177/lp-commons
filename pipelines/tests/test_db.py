"""Integration tests against a real Postgres (TEST_DATABASE_URL)."""

from datetime import date

import httpx
import pytest

from helpers import bulk_zip, filing
from lpmap import db, pipeline
from lpmap.sec_client import RateLimiter, SecClient
from lpmap.sources import formd

UA = "OpenSource LP Map test@example.com"


def _entry(acc="0001999001-25-000002", filed=date(2025, 10, 1)):
    return formd.IndexEntry(1999001, "Example Ventures Fund II, L.P.", "D/A", filed, acc)


def test_migrate_is_idempotent(conn):
    assert db.migrate(conn) == []


def test_upsert_filing_is_idempotent_and_skips_org_persons(conn, fixtures):
    f = formd.parse_primary_doc((fixtures / "primary_doc_vc.xml").read_bytes(), _entry())
    db.upsert_filing(conn, f)
    db.upsert_filing(conn, f)
    conn.commit()
    counts = conn.execute(
        "SELECT (SELECT count(*) FROM entities), (SELECT count(*) FROM formd_filings), "
        "(SELECT count(*) FROM people), (SELECT count(*) FROM roles)").fetchone()
    assert counts == (1, 1, 1, 1)  # GP LLC listed as related person is not a person
    person = conn.execute("SELECT full_name, name_normalized, state FROM people").fetchone()
    assert person == ("Jane Q Doe", "jane doe", "CA")
    row = conn.execute("SELECT name, total_offering_amount, num_investors, federal_exemptions, fund_category "
                       "FROM fund_latest_offering").fetchone()
    assert row == ("Example Ventures Fund II, L.P.", 50000000, 41, ["06b", "3C", "3C.1"], "vc")


def test_newer_filing_renames_entity_older_does_not(conn, fixtures):
    xml = (fixtures / "primary_doc_vc.xml").read_bytes()
    newer = formd.parse_primary_doc(xml, _entry())
    db.upsert_filing(conn, newer)
    older = formd.parse_primary_doc(xml.replace(b"Fund II, L.P.", b"Fund II LP (old name)"),
                                    _entry("0001999001-24-000001", date(2024, 4, 1)))
    db.upsert_filing(conn, older)
    conn.commit()
    assert conn.execute("SELECT name, aliases FROM entities").fetchone() == ("Example Ventures Fund II, L.P.", [])
    assert conn.execute("SELECT count(*) FROM formd_filings").fetchone()[0] == 2
    latest = conn.execute("SELECT accession_number FROM fund_latest_offering").fetchone()[0]
    assert latest == "0001999001-25-000002"

    renamed = formd.parse_primary_doc(xml.replace(b"Fund II, L.P.", b"Fund II, LP"),
                                      _entry("0001999001-26-000001", date(2026, 1, 5)))
    db.upsert_filing(conn, renamed)
    assert conn.execute("SELECT name, aliases FROM entities").fetchone() == \
        ("Example Ventures Fund II, LP", ["Example Ventures Fund II, L.P."])


LISTING_TMPL = '<a href="{}">{}</a>'
SD = "/files/structureddata/data/form-d-data-sets/"
DSI = "/files/datastandardsinnovation/data/form-d-data-sets/"


def listing(*paths: str) -> bytes:
    return ("<ul>" + "".join(LISTING_TMPL.format(p, p) for p in paths) + "</ul>").encode()


def _sec(routes: dict, requested: list | None = None) -> SecClient:
    def handler(req: httpx.Request):
        url = str(req.url)
        if requested is not None:
            requested.append(url)
        return httpx.Response(200, content=routes[url]) if url in routes else httpx.Response(404)

    return SecClient(UA, transport=httpx.MockTransport(handler), sleep=lambda s: None,
                     limiter=RateLimiter(10, sleep=lambda s: None))


def test_sync_backfills_quarters_then_daily(conn, fixtures):
    q3 = bulk_zip([filing("0000000001-25-000001", 1, "Seed Ventures Fund I, L.P.", filed="15-AUG-2025"),
                   filing("0000000002-25-000001", 2, "Macro LP", fund_type="Hedge Fund")])
    q2 = bulk_zip([filing("0000000003-25-000001", 3, "EM Fund of Funds", fund_type="Other Investment Fund")])
    idx = (fixtures / "master.20251001.idx").read_text()
    vc_xml = (fixtures / "primary_doc_vc.xml").read_bytes()
    hedge_xml = vc_xml.replace(b"Venture Capital Fund", b"Hedge Fund")
    requested = []
    sec = _sec({
        formd.BULK_LISTING_URL: listing(DSI + "2025q3_d.zip", DSI + "2025q3_d_0.zip", SD + "2025q2_d.zip",
                                        SD + "2025q1_d.zip"),
        "https://www.sec.gov" + DSI + "2025q3_d_0.zip": q3,
        "https://www.sec.gov" + SD + "2025q2_d.zip": q2,
        formd.daily_index_url(date(2025, 10, 1)): idx.encode(),
        _entry().primary_doc_url: vc_xml,
        "https://www.sec.gov/Archives/edgar/data/1999002/000199900225000001/primary_doc.xml": hedge_xml,
    }, requested)

    stats = pipeline.sync(conn, sec, "2025q2", today=date(2025, 10, 3))
    assert stats["quarters"] == {"2025q2": 1, "2025q3": 1}  # 2025q1 is before backfill_from
    assert stats["days"] == {"2025-10-01": 1, "2025-10-02": None}
    assert not any(u.endswith("2025q1_d.zip") or u.endswith("2025q3_d.zip") for u in requested)

    s = pipeline.status(conn)
    assert (s["vc_funds"], s["fofs"], s["filings"], s["bulk_quarters_done"]) == (2, 1, 3, 2)
    assert s["latest_daily_index"] == "2025-10-01"

    # Second run: only the listing and the still-missing 2025-10-02 index.
    requested.clear()
    stats = pipeline.sync(conn, sec, "2025q2", today=date(2025, 10, 3))
    assert stats == {"quarters": {}, "days": {"2025-10-02": None}}
    assert requested == [formd.BULK_LISTING_URL, formd.daily_index_url(date(2025, 10, 2))]


def test_sync_max_quarters_defers_daily(conn):
    empty = bulk_zip([])
    paths = [SD + f"{y}q{q}_d.zip" for y in (2024, 2025) for q in (1, 2, 3, 4)]
    sec = _sec({formd.BULK_LISTING_URL: listing(*paths), **{"https://www.sec.gov" + p: empty for p in paths}})
    stats = pipeline.sync(conn, sec, "2024q1", today=date(2025, 10, 3), max_quarters=2)
    assert stats == {"quarters": {"2024q1": 0, "2024q2": 0}, "days": {}}


def test_sync_refuses_empty_listing(conn):
    sec = _sec({formd.BULK_LISTING_URL: b"<html>redesigned page</html>"})
    with pytest.raises(RuntimeError, match="no Form D data set links"):
        pipeline.sync(conn, sec, "2024q1", today=date(2025, 10, 3))


def test_active_funds_view(conn):
    today = date.today()
    recent = today.replace(day=1)

    def make(acc, cik, name, filed, first_sale):
        f = formd.FormDFiling(accession_number=acc, cik=cik, entity_name=name, submission_type="D", filed_at=filed,
                              industry_group="Pooled Investment Fund", investment_fund_type="Venture Capital Fund",
                              date_of_first_sale=first_sale)
        db.upsert_filing(conn, f)

    make("1-1", 1, "New Active Fund I", recent, date(2022, 5, 1))          # active, 2022 vintage
    make("2-1", 2, "Old Fund Still Filing", recent, date(2014, 1, 1))      # active but pre-2016 vintage
    make("3-1", 3, "Stale Fund II", date(2019, 3, 1), date(2018, 6, 1))    # 2018 vintage, no recent filing
    make("4-1", 4, "Raising Fund III", date(2023, 1, 10), None)            # first filing 2023 ...
    make("4-2", 4, "Raising Fund III", recent, None)                       # ... amended recently
    conn.commit()
    rows = conn.execute("SELECT name, vintage, filing_count FROM active_funds ORDER BY cik").fetchall()
    assert rows == [("New Active Fund I", 2022, 1), ("Raising Fund III", 2023, 2)]
