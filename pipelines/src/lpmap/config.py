import os
import re
from dataclasses import dataclass
from pathlib import Path

# SEC fair access policy: no more than 10 requests per second, across all sec.gov hosts.
SEC_MAX_RPS_CAP = 10

MIGRATIONS_DIR = Path(os.environ.get("LPMAP_MIGRATIONS_DIR", Path(__file__).resolve().parents[3] / "db" / "migrations"))


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Config:
    sec_user_agent: str
    sec_max_rps: float
    database_url: str
    formd_backfill_from: str


def validate_user_agent(ua: str) -> str:
    ua = ua.strip().strip('"')
    if not re.search(r"[^@\s]+@[^@\s]+\.[^@\s]+", ua):
        raise ConfigError(
            "SEC_USER_AGENT must include a contact email, e.g. 'Your Org you@example.com' "
            "(required by SEC; requests without one are blocked with 403)."
        )
    return ua


def load() -> Config:
    ua = os.environ.get("SEC_USER_AGENT", "")
    if not ua:
        raise ConfigError("SEC_USER_AGENT is not set.")
    db = os.environ.get("DATABASE_URL", "")
    if not db:
        raise ConfigError("DATABASE_URL is not set.")
    rps = min(float(os.environ.get("SEC_MAX_RPS", SEC_MAX_RPS_CAP)), SEC_MAX_RPS_CAP)
    if rps <= 0:
        raise ConfigError("SEC_MAX_RPS must be positive.")
    return Config(
        sec_user_agent=validate_user_agent(ua),
        sec_max_rps=rps,
        database_url=db,
        formd_backfill_from=os.environ.get("FORMD_BACKFILL_FROM", "2009q1").lower(),
    )
