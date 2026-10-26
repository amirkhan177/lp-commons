import re
import unicodedata
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

_DATE_FORMATS = ("%Y-%m-%d", "%d-%b-%Y", "%m/%d/%Y", "%Y%m%d")


def clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def name_key(name: str) -> str:
    """Lowercase ASCII, punctuation stripped, whitespace collapsed. Used for dedupe + trigram search."""
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    name = re.sub(r"[^a-z0-9 ]+", " ", name.lower())
    return re.sub(r"\s+", " ", name).strip()


def person_name(first: str | None, middle: str | None, last: str | None) -> str:
    return " ".join(p for p in (clean(first), clean(middle), clean(last)) if p)


def person_key(first: str | None, last: str | None) -> str:
    """Middle names are dropped: filings use them inconsistently for the same person."""
    return name_key(" ".join(p for p in (clean(first), clean(last)) if p))


_ORG_WORDS = re.compile(
    r"\b(llc|l\.l\.c|lp|l\.p|llp|inc|corp|corporation|ltd|limited|gp|partners|management|capital|"
    r"ventures|fund|holdings|trust|company|co)\b\.?", re.I)
_PLACEHOLDER = {"n/a", "na", "-", "none", "n.a.", ""}


def is_org_related_person(first: str | None, last: str | None) -> bool:
    """Form D related persons are often the GP entity itself, e.g. first='Acme GP, LLC', last='N/A'."""
    full = " ".join(p for p in (clean(first), clean(last)) if p)
    return bool(_ORG_WORDS.search(full)) or (clean(last) or "").lower() in _PLACEHOLDER


def parse_date(value: str | None) -> date | None:
    value = clean(value)
    if not value:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def parse_amount(value: str | None) -> tuple[Decimal | None, bool]:
    """Returns (amount, indefinite). Form D allows the literal 'Indefinite'."""
    value = clean(value)
    if not value:
        return None, False
    if value.lower().startswith("indefinite"):
        return None, True
    try:
        return Decimal(value.replace(",", "").replace("$", "")), False
    except InvalidOperation:
        return None, False


def parse_int(value: str | None) -> int | None:
    amount, _ = parse_amount(value)
    return int(amount) if amount is not None else None


def parse_bool(value: str | None) -> bool | None:
    value = clean(value)
    if value is None:
        return None
    v = value.lower()
    if v in ("true", "yes", "y", "1"):
        return True
    if v in ("false", "no", "n", "0"):
        return False
    return None
