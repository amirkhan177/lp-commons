"""Builds Form D bulk-data-set zips in the SEC TSV layout for tests."""

import io
import zipfile

SUBMISSION_COLS = ["ACCESSIONNUMBER", "FILE_NUM", "FILING_DATE", "SIC_CODE", "SCHEMAVERSION",
                   "SUBMISSIONTYPE", "TESTORLIVE", "OVER100PERSONSFLAG", "OVER100ISSUERFLAG"]
ISSUER_COLS = ["ACCESSIONNUMBER", "IS_PRIMARYISSUER_FLAG", "ISSUER_SEQ_KEY", "CIK", "ENTITYNAME", "STREET1",
               "CITY", "STATEORCOUNTRY", "ZIPCODE", "JURISDICTIONOFINC", "ENTITYTYPE"]
OFFERING_COLS = ["ACCESSIONNUMBER", "INDUSTRYGROUPTYPE", "INVESTMENTFUNDTYPE", "IS40ACT",
                 "FEDERALEXEMPTIONS_ITEMS_LIST", "ISAMENDMENT", "PREVIOUSACCESSIONNUMBER", "SALE_DATE",
                 "YETTOOCCUR", "MINIMUMINVESTMENTACCEPTED", "TOTALOFFERINGAMOUNT", "TOTALAMOUNTSOLD",
                 "TOTALREMAINING", "HASNONACCREDITEDINVESTORS", "NUMBERNONACCREDITEDINVESTORS",
                 "TOTALNUMBERALREADYINVESTED", "SALESCOMM_DOLLARAMOUNT", "FINDERSFEE_DOLLARAMOUNT"]
RELATED_COLS = ["ACCESSIONNUMBER", "RELATEDPERSON_SEQ_KEY", "FIRSTNAME", "MIDDLENAME", "LASTNAME", "CITY",
                "STATEORCOUNTRY", "RELATIONSHIP_1", "RELATIONSHIP_2", "RELATIONSHIP_3",
                "RELATIONSHIPCLARIFICATION"]


def _tsv(cols: list[str], rows: list[dict]) -> str:
    lines = ["\t".join(cols)] + ["\t".join(str(r.get(c, "")) for c in cols) for r in rows]
    return "\n".join(lines) + "\n"


def filing(acc: str, cik: int, name: str, industry="Pooled Investment Fund", fund_type="Venture Capital Fund",
           filed="01-APR-2025", sub_type="D", test_or_live="LIVE", **offering) -> dict:
    return {
        "sub": {"ACCESSIONNUMBER": acc, "FILING_DATE": filed, "SUBMISSIONTYPE": sub_type, "TESTORLIVE": test_or_live},
        "iss": {"ACCESSIONNUMBER": acc, "IS_PRIMARYISSUER_FLAG": "YES", "CIK": cik, "ENTITYNAME": name,
                "CITY": "New York", "STATEORCOUNTRY": "NY", "ENTITYTYPE": "Limited Partnership"},
        "off": {"ACCESSIONNUMBER": acc, "INDUSTRYGROUPTYPE": industry, "INVESTMENTFUNDTYPE": fund_type,
                "IS40ACT": "false", "FEDERALEXEMPTIONS_ITEMS_LIST": "06b,3C.1", "ISAMENDMENT": "false",
                "SALE_DATE": "2025-02-01", "TOTALOFFERINGAMOUNT": "25000000", "TOTALAMOUNTSOLD": "10000000",
                "TOTALREMAINING": "15000000", "MINIMUMINVESTMENTACCEPTED": "100000",
                "TOTALNUMBERALREADYINVESTED": "17", "HASNONACCREDITEDINVESTORS": "false", **offering},
    }


def bulk_zip(filings: list[dict], related: list[dict] = (), folder="2025Q2_d") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(f"{folder}/FORMDSUBMISSION.tsv", _tsv(SUBMISSION_COLS, [f["sub"] for f in filings]))
        zf.writestr(f"{folder}/ISSUERS.tsv", _tsv(ISSUER_COLS, [f["iss"] for f in filings]))
        zf.writestr(f"{folder}/OFFERING.tsv", _tsv(OFFERING_COLS, [f["off"] for f in filings]))
        zf.writestr(f"{folder}/RELATEDPERSONS.tsv", _tsv(RELATED_COLS, list(related)))
    return buf.getvalue()
