from datetime import date
from decimal import Decimal

import pytest

from helpers import bulk_zip, filing
from lpmap.normalize import is_org_related_person, parse_amount, parse_date, person_key
from lpmap.sources import formd


@pytest.mark.parametrize("industry,fund_type,name,expected", [
    ("Pooled Investment Fund", "Venture Capital Fund", "Acme Ventures I, L.P.", "vc"),
    ("Pooled Investment Fund", "Hedge Fund", "Acme Macro LP", None),
    ("Pooled Investment Fund", "Private Equity Fund", "Acme Buyout III", None),
    ("Pooled Investment Fund", "Other Investment Fund", "Emerging Managers Fund of Funds II", "fof"),
    ("Pooled Investment Fund", "Private Equity Fund", "Northside Fund-of-Funds LP", "fof"),
    ("Pooled Investment Fund", "venture capital fund", "lowercase ok", "vc"),
    ("Technology", "Venture Capital Fund", "Not a fund", None),
    (None, None, "Fund of Funds Inc", None),
])
def test_classify(industry, fund_type, name, expected):
    assert formd.classify(industry, fund_type, name) == expected


def test_parse_bulk_zip_keeps_only_vc_and_fof():
    data = bulk_zip(
        [
            filing("0000000001-25-000001", 1, "Seed Ventures Fund I, L.P."),
            filing("0000000002-25-000001", 2, "Macro Hedge LP", fund_type="Hedge Fund"),
            filing("0000000003-25-000001", 3, "EM Fund of Funds I", fund_type="Other Investment Fund",
                   TOTALOFFERINGAMOUNT="Indefinite"),
            filing("0000000004-25-000001", 4, "Test Ventures", test_or_live="TEST"),
            filing("0000000005-25-000001", 5, "Acme Robotics Inc", industry="Technology", fund_type=""),
        ],
        related=[
            {"ACCESSIONNUMBER": "0000000001-25-000001", "FIRSTNAME": "Ana", "LASTNAME": "Silva", "CITY": "Austin",
             "STATEORCOUNTRY": "TX", "RELATIONSHIP_1": "Executive Officer", "RELATIONSHIP_2": "Director"},
            {"ACCESSIONNUMBER": "0000000002-25-000001", "FIRSTNAME": "Hedge", "LASTNAME": "Person"},
        ],
    )
    out = {f.cik: f for f in formd.parse_bulk_zip(data)}
    assert set(out) == {1, 3}

    vc = out[1]
    assert vc.entity_name == "Seed Ventures Fund I, L.P."
    assert vc.filed_at == date(2025, 4, 1)
    assert vc.total_offering_amount == Decimal("25000000")
    assert vc.total_amount_sold == Decimal("10000000")
    assert vc.num_investors == 17
    assert vc.federal_exemptions == ["06b", "3C.1"]
    assert vc.date_of_first_sale == date(2025, 2, 1)
    assert [p.last_name for p in vc.related_persons] == ["Silva"]
    assert vc.related_persons[0].relationships == ["Executive Officer", "Director"]
    assert vc.source_url == ("https://www.sec.gov/Archives/edgar/data/1/000000000125000001/"
                             "0000000001-25-000001-index.htm")

    fof = out[3]
    assert fof.offering_indefinite is True and fof.total_offering_amount is None


def test_parse_bulk_zip_tolerates_lowercase_headers():
    data = bulk_zip([filing("0000000001-25-000001", 1, "Seed Ventures Fund I")])
    import io, zipfile
    src = zipfile.ZipFile(io.BytesIO(data))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as dst:
        for name in src.namelist():
            text = src.read(name).decode()
            header, rest = text.split("\n", 1)
            dst.writestr(name.lower(), header.lower() + "\n" + rest)
    assert len(formd.parse_bulk_zip(buf.getvalue())) == 1


def test_parse_master_index(fixtures):
    entries = formd.parse_master_index((fixtures / "master.20251001.idx").read_text())
    assert [(e.cik, e.form_type, e.accession_number) for e in entries] == [
        (1999001, "D/A", "0001999001-25-000002"),
        (1999002, "D", "0001999002-25-000001"),
    ]
    assert entries[0].filed_at == date(2025, 10, 1)
    assert entries[0].primary_doc_url == \
        "https://www.sec.gov/Archives/edgar/data/1999001/000199900125000002/primary_doc.xml"


def test_daily_index_url():
    assert formd.daily_index_url(date(2025, 10, 1)) == \
        "https://www.sec.gov/Archives/edgar/daily-index/2025/QTR4/master.20251001.idx"


def test_parse_primary_doc(fixtures):
    entry = formd.IndexEntry(1999001, "Example Ventures Fund II, L.P.", "D/A", date(2025, 10, 1),
                             "0001999001-25-000002")
    f = formd.parse_primary_doc((fixtures / "primary_doc_vc.xml").read_bytes(), entry)
    assert f is not None
    assert (f.cik, f.submission_type, f.state, f.entity_form) == (1999001, "D/A", "CA", "Limited Partnership")
    assert f.is_amendment and f.previous_accession == "0001999001-24-000001"
    assert f.federal_exemptions == ["06b", "3C", "3C.1"]
    assert f.total_offering_amount == Decimal("50000000")
    assert f.total_amount_sold == Decimal("32500000")
    assert f.minimum_investment == Decimal("250000")
    assert f.num_investors == 41
    assert f.is_40act is False
    assert f.date_of_first_sale == date(2024, 3, 15)
    assert f.source == "xml"
    jane = f.related_persons[0]
    assert (jane.first_name, jane.middle_name, jane.last_name) == ("Jane", "Q", "Doe")
    assert jane.relationships == ["Executive Officer", "Promoter"]
    assert jane.clarification == "Managing Member of the General Partner"
    assert len(f.related_persons) == 2


def test_parse_primary_doc_drops_non_vc(fixtures):
    xml = (fixtures / "primary_doc_vc.xml").read_text().replace("Venture Capital Fund", "Hedge Fund")
    entry = formd.IndexEntry(1999001, "x", "D", None, "0001999001-25-000002")
    assert formd.parse_primary_doc(xml, entry) is None


def test_normalize_helpers():
    assert parse_amount("Indefinite") == (None, True)
    assert parse_amount("1,000,000") == (Decimal("1000000"), False)
    assert parse_amount("") == (None, False)
    assert parse_date("31-MAR-2025") == date(2025, 3, 31)
    assert parse_date("2025-03-31") == date(2025, 3, 31)
    assert parse_date("garbage") is None
    assert person_key("José", "O'Neil") == "jose o neil"
    assert is_org_related_person("Example Ventures GP II, LLC", "N/A")
    assert is_org_related_person("Acme", "Partners")
    assert not is_org_related_person("Jane", "Doe")


def test_parse_bulk_listing_picks_real_paths_and_latest_revision():
    html = """
      <a href="/files/datastandardsinnovation/data/form-d-data-sets/2026q3_d.zip">2026 Q3</a>
      <a href="/files/structureddata/data/form-d-data-sets/2008q3_d.zip">2008 Q3</a>
      <a href="/files/structureddata/data/form-d-data-sets/2008q3_d_0.zip">2008 Q3 (revised)</a>
      <a href="https://www.sec.gov/files/structureddata/data/form-d-data-sets/2016Q1_d.zip">2016 Q1</a>
      <a href="/files/other/readme.pdf">readme</a>
    """
    assert formd.parse_bulk_listing(html) == {
        (2026, 3): "https://www.sec.gov/files/datastandardsinnovation/data/form-d-data-sets/2026q3_d.zip",
        (2008, 3): "https://www.sec.gov/files/structureddata/data/form-d-data-sets/2008q3_d_0.zip",
        (2016, 1): "https://www.sec.gov/files/structureddata/data/form-d-data-sets/2016Q1_d.zip",
    }
