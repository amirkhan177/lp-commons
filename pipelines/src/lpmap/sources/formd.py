"""Form D: SEC quarterly bulk data sets + per-filing primary_doc.xml.

Bulk:  https://www.sec.gov/files/structureddata/data/form-d-data-sets/{YYYY}q{N}_d.zip
       (FORMDSUBMISSION, ISSUERS, OFFERING, RELATEDPERSONS ... .tsv)
Daily: https://www.sec.gov/Archives/edgar/daily-index/{YYYY}/QTR{N}/master.{YYYYMMDD}.idx
       then https://www.sec.gov/Archives/edgar/data/{cik}/{accession-no-dashes}/primary_doc.xml

Both paths produce the same FormDFiling record. Only venture capital funds and
funds-of-funds are kept (see classify()).
"""

import csv
import io
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from ..normalize import clean, parse_amount, parse_bool, parse_date, parse_int

BULK_URL = "https://www.sec.gov/files/structureddata/data/form-d-data-sets/{year}q{q}_d.zip"
DAILY_INDEX_URL = "https://www.sec.gov/Archives/edgar/daily-index/{year}/QTR{q}/master.{ymd}.idx"
FILING_INDEX_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc_nodash}/{acc}-index.htm"
PRIMARY_DOC_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc_nodash}/primary_doc.xml"

POOLED_FUND = "pooled investment fund"
VC_FUND = "venture capital fund"
_FOF_NAME = re.compile(r"\bfund[\s-]+of[\s-]+funds\b|\bfof\b|\bfunds of funds\b", re.I)


@dataclass
class RelatedPerson:
    first_name: str | None
    middle_name: str | None
    last_name: str | None
    city: str | None
    state: str | None
    relationships: list[str] = field(default_factory=list)
    clarification: str | None = None


@dataclass
class FormDFiling:
    accession_number: str
    cik: int
    entity_name: str
    submission_type: str
    filed_at: date | None
    city: str | None = None
    state: str | None = None
    jurisdiction: str | None = None
    entity_form: str | None = None
    industry_group: str | None = None
    investment_fund_type: str | None = None
    is_40act: bool | None = None
    is_amendment: bool = False
    previous_accession: str | None = None
    federal_exemptions: list[str] = field(default_factory=list)
    date_of_first_sale: date | None = None
    first_sale_yet_to_occur: bool | None = None
    total_offering_amount: Decimal | None = None
    offering_indefinite: bool = False
    total_amount_sold: Decimal | None = None
    total_remaining: Decimal | None = None
    minimum_investment: Decimal | None = None
    num_investors: int | None = None
    has_non_accredited: bool | None = None
    num_non_accredited: int | None = None
    sales_commissions: Decimal | None = None
    finders_fees: Decimal | None = None
    related_persons: list[RelatedPerson] = field(default_factory=list)
    source: str = "bulk"

    @property
    def source_url(self) -> str:
        return FILING_INDEX_URL.format(cik=self.cik, acc_nodash=self.accession_number.replace("-", ""),
                                       acc=self.accession_number)


def classify(industry_group: str | None, fund_type: str | None, entity_name: str) -> str | None:
    """'vc', 'fof', or None (drop).

    Form D has no fund-of-funds checkbox, so FoFs are pooled funds whose name says so.
    """
    if (industry_group or "").strip().lower() != POOLED_FUND:
        return None
    if _FOF_NAME.search(entity_name or ""):
        return "fof"
    if (fund_type or "").strip().lower() == VC_FUND:
        return "vc"
    return None


# ---------------------------------------------------------------------------
# Bulk quarterly data sets
# ---------------------------------------------------------------------------

def quarter_url(year: int, q: int) -> str:
    return BULK_URL.format(year=year, q=q)


def _read_tsv(zf: zipfile.ZipFile, table: str) -> list[dict[str, str]]:
    name = next((n for n in zf.namelist() if n.rsplit("/", 1)[-1].upper() == f"{table}.TSV"), None)
    if name is None:
        raise ValueError(f"{table}.tsv not found in archive ({zf.namelist()})")
    text = io.TextIOWrapper(zf.open(name), encoding="utf-8", errors="replace", newline="")
    reader = csv.DictReader(text, delimiter="\t", quoting=csv.QUOTE_NONE)
    # Header names upper-cased so minor casing differences between quarters don't matter.
    return [{(k or "").strip().upper(): v for k, v in row.items()} for row in reader]


def parse_bulk_zip(data: bytes) -> list[FormDFiling]:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        offerings = {r["ACCESSIONNUMBER"]: r for r in _read_tsv(zf, "OFFERING")}
        issuers = {r["ACCESSIONNUMBER"]: r for r in _read_tsv(zf, "ISSUERS")
                   if (r.get("IS_PRIMARYISSUER_FLAG") or "").upper() in ("YES", "Y", "TRUE", "")}
        keep: dict[str, FormDFiling] = {}
        for sub in _read_tsv(zf, "FORMDSUBMISSION"):
            acc = sub["ACCESSIONNUMBER"]
            off, iss = offerings.get(acc), issuers.get(acc)
            if off is None or iss is None or (sub.get("TESTORLIVE") or "LIVE").upper() == "TEST":
                continue
            name = clean(iss.get("ENTITYNAME")) or ""
            if classify(off.get("INDUSTRYGROUPTYPE"), off.get("INVESTMENTFUNDTYPE"), name) is None:
                continue
            keep[acc] = _bulk_filing(sub, iss, off)
        for rp in _read_tsv(zf, "RELATEDPERSONS"):
            filing = keep.get(rp["ACCESSIONNUMBER"])
            if filing is not None:
                filing.related_persons.append(RelatedPerson(
                    first_name=clean(rp.get("FIRSTNAME")),
                    middle_name=clean(rp.get("MIDDLENAME")),
                    last_name=clean(rp.get("LASTNAME")),
                    city=clean(rp.get("CITY")),
                    state=clean(rp.get("STATEORCOUNTRY")),
                    relationships=[r for r in (clean(rp.get(f"RELATIONSHIP_{i}")) for i in (1, 2, 3)) if r],
                    clarification=clean(rp.get("RELATIONSHIPCLARIFICATION")),
                ))
    return list(keep.values())


def _bulk_filing(sub: dict, iss: dict, off: dict) -> FormDFiling:
    total, indefinite = parse_amount(off.get("TOTALOFFERINGAMOUNT"))
    exemptions = [e.strip() for e in (off.get("FEDERALEXEMPTIONS_ITEMS_LIST") or "").split(",") if e.strip()]
    return FormDFiling(
        accession_number=sub["ACCESSIONNUMBER"],
        cik=int(iss["CIK"]),
        entity_name=clean(iss.get("ENTITYNAME")) or "",
        submission_type=clean(sub.get("SUBMISSIONTYPE")) or "D",
        filed_at=parse_date(sub.get("FILING_DATE")),
        city=clean(iss.get("CITY")),
        state=clean(iss.get("STATEORCOUNTRY")),
        jurisdiction=clean(iss.get("JURISDICTIONOFINC")),
        entity_form=clean(iss.get("ENTITYTYPE")),
        industry_group=clean(off.get("INDUSTRYGROUPTYPE")),
        investment_fund_type=clean(off.get("INVESTMENTFUNDTYPE")),
        is_40act=parse_bool(off.get("IS40ACT")),
        is_amendment=bool(parse_bool(off.get("ISAMENDMENT"))),
        previous_accession=clean(off.get("PREVIOUSACCESSIONNUMBER")),
        federal_exemptions=exemptions,
        date_of_first_sale=parse_date(off.get("SALE_DATE")),
        first_sale_yet_to_occur=parse_bool(off.get("YETTOOCCUR")),
        total_offering_amount=total,
        offering_indefinite=indefinite,
        total_amount_sold=parse_amount(off.get("TOTALAMOUNTSOLD"))[0],
        total_remaining=parse_amount(off.get("TOTALREMAINING"))[0],
        minimum_investment=parse_amount(off.get("MINIMUMINVESTMENTACCEPTED"))[0],
        num_investors=parse_int(off.get("TOTALNUMBERALREADYINVESTED")),
        has_non_accredited=parse_bool(off.get("HASNONACCREDITEDINVESTORS")),
        num_non_accredited=parse_int(off.get("NUMBERNONACCREDITEDINVESTORS")),
        sales_commissions=parse_amount(off.get("SALESCOMM_DOLLARAMOUNT"))[0],
        finders_fees=parse_amount(off.get("FINDERSFEE_DOLLARAMOUNT"))[0],
        source="bulk",
    )


# ---------------------------------------------------------------------------
# Daily index + primary_doc.xml
# ---------------------------------------------------------------------------

@dataclass
class IndexEntry:
    cik: int
    company: str
    form_type: str
    filed_at: date | None
    accession_number: str

    @property
    def primary_doc_url(self) -> str:
        return PRIMARY_DOC_URL.format(cik=self.cik, acc_nodash=self.accession_number.replace("-", ""))


def daily_index_url(day: date) -> str:
    return DAILY_INDEX_URL.format(year=day.year, q=(day.month - 1) // 3 + 1, ymd=day.strftime("%Y%m%d"))


def parse_master_index(text: str, forms: tuple[str, ...] = ("D", "D/A")) -> list[IndexEntry]:
    """master.idx rows: CIK|Company Name|Form Type|Date Filed|edgar/data/{cik}/{accession}.txt"""
    out = []
    for line in text.splitlines():
        parts = line.split("|")
        if len(parts) != 5 or not parts[0].strip().isdigit():
            continue
        cik, company, form, filed, path = (p.strip() for p in parts)
        if form not in forms:
            continue
        acc = path.rsplit("/", 1)[-1].removesuffix(".txt")
        out.append(IndexEntry(int(cik), company, form, parse_date(filed), acc))
    return out


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _find(el: ET.Element | None, *path: str) -> ET.Element | None:
    for name in path:
        if el is None:
            return None
        el = next((c for c in el if _local(c.tag) == name), None)
    return el


def _text(el: ET.Element | None, *path: str) -> str | None:
    found = _find(el, *path)
    return clean(found.text) if found is not None else None


def _texts(el: ET.Element | None, *path: str) -> list[str]:
    parent = _find(el, *path[:-1])
    if parent is None:
        return []
    return [t for c in parent if _local(c.tag) == path[-1] and (t := clean(c.text))]


def parse_primary_doc(xml: bytes | str, entry: IndexEntry) -> FormDFiling | None:
    """Parse a Form D primary_doc.xml. Returns None if not a VC fund / fund-of-funds."""
    root = ET.fromstring(xml)
    issuer = _find(root, "primaryIssuer")
    offering = _find(root, "offeringData")
    name = _text(issuer, "entityName") or entry.company
    industry = _text(offering, "industryGroup", "industryGroupType")
    fund_type = _text(offering, "industryGroup", "investmentFundInfo", "investmentFundType")
    if classify(industry, fund_type, name) is None:
        return None

    amounts = _find(offering, "offeringSalesAmounts")
    total, indefinite = parse_amount(_text(amounts, "totalOfferingAmount"))
    investors = _find(offering, "investors")
    first_sale = _find(offering, "typeOfFiling", "dateOfFirstSale")

    filing = FormDFiling(
        accession_number=entry.accession_number,
        cik=int(_text(issuer, "cik") or entry.cik),
        entity_name=name,
        submission_type=_text(root, "submissionType") or entry.form_type,
        filed_at=entry.filed_at,
        city=_text(issuer, "issuerAddress", "city"),
        state=_text(issuer, "issuerAddress", "stateOrCountry"),
        jurisdiction=_text(issuer, "jurisdictionOfInc"),
        entity_form=_text(issuer, "entityType"),
        industry_group=industry,
        investment_fund_type=fund_type,
        is_40act=parse_bool(_text(offering, "industryGroup", "investmentFundInfo", "is40Act")),
        is_amendment=bool(parse_bool(_text(offering, "typeOfFiling", "newOrAmendment", "isAmendment"))),
        previous_accession=_text(offering, "typeOfFiling", "newOrAmendment", "previousAccessionNumber"),
        federal_exemptions=_texts(offering, "federalExemptionsExclusions", "item"),
        date_of_first_sale=parse_date(_text(first_sale, "value")),
        first_sale_yet_to_occur=parse_bool(_text(first_sale, "yetToOccur")),
        total_offering_amount=total,
        offering_indefinite=indefinite,
        total_amount_sold=parse_amount(_text(amounts, "totalAmountSold"))[0],
        total_remaining=parse_amount(_text(amounts, "totalRemaining"))[0],
        minimum_investment=parse_amount(_text(offering, "minimumInvestmentAccepted"))[0],
        num_investors=parse_int(_text(investors, "totalNumberAlreadyInvested")),
        has_non_accredited=parse_bool(_text(investors, "hasNonAccreditedInvestors")),
        num_non_accredited=parse_int(_text(investors, "numberNonAccreditedInvestors")),
        sales_commissions=parse_amount(_text(offering, "salesCommissionsFindersFees", "salesCommissions", "dollarAmount"))[0],
        finders_fees=parse_amount(_text(offering, "salesCommissionsFindersFees", "findersFees", "dollarAmount"))[0],
        source="xml",
    )
    persons = _find(root, "relatedPersonsList")
    for rp in (persons if persons is not None else []):
        if _local(rp.tag) != "relatedPersonInfo":
            continue
        filing.related_persons.append(RelatedPerson(
            first_name=_text(rp, "relatedPersonName", "firstName"),
            middle_name=_text(rp, "relatedPersonName", "middleName"),
            last_name=_text(rp, "relatedPersonName", "lastName"),
            city=_text(rp, "relatedPersonAddress", "city"),
            state=_text(rp, "relatedPersonAddress", "stateOrCountry"),
            relationships=_texts(rp, "relatedPersonRelationshipList", "relationship"),
            clarification=_text(rp, "relationshipClarification"),
        ))
    return filing
