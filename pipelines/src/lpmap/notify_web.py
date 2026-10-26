"""Tell the web app that new filings landed, so it can re-map intro paths.

Optional: does nothing unless WEB_INTERNAL_URL and AGENT_SHARED_SECRET are set. Failures are
logged, never raised: the data is already saved; the web app's weekly re-map is the fallback.
"""

import logging
import os

import httpx

log = logging.getLogger(__name__)


def new_filings_count(stats: dict) -> int:
    counts = list(stats.get("quarters", {}).values()) + list(stats.get("days", {}).values())
    return sum(n for n in counts if isinstance(n, int))


def filings_updated(count: int, transport: httpx.BaseTransport | None = None) -> bool:
    url, secret = os.environ.get("WEB_INTERNAL_URL", ""), os.environ.get("AGENT_SHARED_SECRET", "")
    if count <= 0 or not url or not secret:
        return False
    try:
        with httpx.Client(timeout=15, transport=transport) as client:
            resp = client.post(f"{url.rstrip('/')}/api/internal/filings-updated",
                               headers={"x-agent-secret": secret}, json={"new_filings": count})
        resp.raise_for_status()
        log.info("web app notified of %d new filings", count)
        return True
    except httpx.HTTPError as exc:
        log.warning("could not notify web app: %s", exc)
        return False
