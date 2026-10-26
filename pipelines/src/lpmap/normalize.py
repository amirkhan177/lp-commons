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


_SUFFIX_ONLY = re.compile(r"^(llc|l\.l\.c\.?|lp|l\.p\.?|llp|inc\.?|ltd\.?|limited|corp\.?|co\.?)$", re.I)


# Filers sometimes type the role into the name field: "General Partner Acme GP, LLC".
_LABEL_PREFIX = re.compile(r"^(?:(?:\[none\]|\(none\)|general\s+partner|management\s+company|managing\s+member|investment\s+manager)\s+)+", re.I)


def org_name(first: str | None, middle: str | None, last: str | None) -> str | None:
    """Rebuild an organization's name from Form D's person-shaped fields.

    Filers squeeze names in oddly: ('N/A', 'Acme GP, LLC'), ('Seed Labs', 'LLC'), ('LLC', 'Sydecar').
    """
    junk = lambda x: x.lower() in _PLACEHOLDER or x.lower() in {"(none)", "[none]", "none."} or not re.search(r"[a-z0-9]", x, re.I)
    parts = [x for x in (clean(first), clean(middle), clean(last)) if x and not junk(x)]
    if not parts:
        return None
    if len(parts) == 2 and _SUFFIX_ONLY.match(parts[0]):
        parts = [parts[1], parts[0]]           # ('LLC', 'Sydecar') -> 'Sydecar LLC'
    name = _LABEL_PREFIX.sub("", " ".join(parts))
    name = re.sub(r"\s+(llc|lp|llp|inc|ltd)\b\.?$", lambda m: ", " + m.group(1).upper(), name, flags=re.I)
    return re.sub(r",\s*,", ",", name).strip(" ,")


_MANAGER = re.compile(r"\b(investment\s+(manager|adviser|advisor)|management\s+company|manager\b|adviser|advisor)", re.I)
_GP = re.compile(r"\b(general\s+partner|managing\s+member|\bgp\b)", re.I)
_PLATFORM = re.compile(r"\b(administrator|agent\s+of|fund\s+admin|custodian|placement|broker)", re.I)
_GENERIC = re.compile(r"^(fund\s+gp|series\s+gp|gp)\b|\bspv\b|\badmin(istrat\w*)?\b", re.I)


def manager_role(clarification: str | None, name: str) -> str | None:
    """'manager' or 'general_partner' for real fund managers; None for platform admins and placeholders."""
    text = clean(clarification) or ""
    if _PLATFORM.search(text) or _GENERIC.search(name):
        return None
    if _GP.search(text):
        return "general_partner"
    if _MANAGER.search(text):
        return "manager"
    # No clarification: fall back to what the name says.
    if re.search(r"\b(management|advisors|advisers|capital\s+partners)\b", name, re.I):
        return "manager"
    if re.search(r"\bgp\b|general\s+partner", name, re.I):
        return "general_partner"
    return None


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
