"""Integration tests against a real Postgres (TEST_DATABASE_URL)."""

from datetime import date

import httpx

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


def test_sync_backfills_quarters_then_daily(conn, fixtures):
    q3 = bulk_zip([filing("0000000001-25-000001", 1, "Seed Ventures Fund I, L.P.", filed="15-AUG-2025"),
                   filing("0000000002-25-000001", 2, "Macro LP", fund_type="Hedge Fund")])
    q2 = bulk_zip([filing("0000000003-25-000001", 3, "EM Fund of Funds", fund_type="Other Investment Fund")])
    idx = (fixtures / "master.20251001.idx").read_text()
    vc_xml = (fixtures / "primary_doc_vc.xml").read_bytes()
    hedge_xml = vc_xml.replace(b"Venture Capital Fund", b"Hedge Fund")
    requested = []

    def handler(req: httpx.Request):
        url = str(req.url)
        requested.append(url)
        routes = {
            formd.quarter_url(2025, 2): q2,
            formd.quarter_url(2025, 3): q3,
            formd.daily_index_url(date(2025, 10, 1)): idx.encode(),
            _entry().primary_doc_url: vc_xml,
            "https://www.sec.gov/Archives/edgar/data/1999002/000199900225000001/primary_doc.xml": hedge_xml,
        }
        return httpx.Response(200, content=routes[url]) if url in routes else httpx.Response(404)

    sec = SecClient(UA, transport=httpx.MockTransport(handler), sleep=lambda s: None,
                    limiter=RateLimiter(10, sleep=lambda s: None))
    stats = pipeline.sync(conn, sec, "2025q2", today=date(2025, 10, 3))
    assert stats["quarters"] == {"2025q2": 1, "2025q3": 1}
    assert stats["days"] == {"2025-10-01": 1, "2025-10-02": None}
    assert formd.quarter_url(2025, 4) not in requested  # running quarter is never fetched

    s = pipeline.status(conn)
    assert (s["vc_funds"], s["fofs"], s["filings"], s["bulk_quarters_done"]) == (2, 1, 3, 2)
    assert s["latest_daily_index"] == "2025-10-01"

    # Second run: nothing left except the still-missing 2025-10-02 index.
    requested.clear()
    stats = pipeline.sync(conn, sec, "2025q2", today=date(2025, 10, 3))
    assert stats == {"quarters": {}, "days": {"2025-10-02": None}}
    assert requested == [formd.daily_index_url(date(2025, 10, 2))]


def test_sync_max_quarters_defers_daily(conn):
    sec = SecClient(UA, transport=httpx.MockTransport(lambda r: httpx.Response(404)), sleep=lambda s: None,
                    limiter=RateLimiter(10, sleep=lambda s: None))
    stats = pipeline.sync(conn, sec, "2024q1", today=date(2025, 10, 3), max_quarters=2)
    assert list(stats["quarters"]) == ["2024q1", "2024q2"] and stats["days"] == {}
