"""HTTP client for sec.gov / data.sec.gov that never exceeds SEC's 10 requests/second limit.

Every request goes through one RateLimiter (sliding one-second window), so the cap holds
across threads and across all SEC hosts. Rate-limit responses (429, or 403 with SEC's
"Request Rate Threshold Exceeded" page) back off exponentially before retrying.
"""

import logging
import threading
import time
from collections import deque
from collections.abc import Callable

import httpx

from .config import SEC_MAX_RPS_CAP, validate_user_agent

log = logging.getLogger(__name__)

RETRY_STATUSES = {429, 500, 502, 503, 504}


class RateLimiter:
    """At most `max_per_second` acquisitions in any rolling 1-second window."""

    def __init__(self, max_per_second: float, clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep):
        self.max = int(min(max_per_second, SEC_MAX_RPS_CAP)) or 1
        self._clock = clock
        self._sleep = sleep
        self._stamps: deque[float] = deque()
        self._lock = threading.Lock()

    def acquire(self) -> None:
        with self._lock:
            while True:
                now = self._clock()
                while self._stamps and now - self._stamps[0] >= 1.0:
                    self._stamps.popleft()
                if len(self._stamps) < self.max:
                    self._stamps.append(now)
                    return
                self._sleep(1.0 - (now - self._stamps[0]) + 0.001)


class NotFound(Exception):
    pass


class SecClient:
    def __init__(self, user_agent: str, max_rps: float = SEC_MAX_RPS_CAP, max_retries: int = 5,
                 transport: httpx.BaseTransport | None = None, sleep: Callable[[float], None] = time.sleep,
                 limiter: RateLimiter | None = None):
        self.limiter = limiter or RateLimiter(max_rps)
        self.max_retries = max_retries
        self._sleep = sleep
        self._http = httpx.Client(
            headers={"User-Agent": validate_user_agent(user_agent), "Accept-Encoding": "gzip, deflate"},
            timeout=httpx.Timeout(60.0, connect=15.0),
            follow_redirects=True,
            transport=transport,
        )

    def get(self, url: str) -> httpx.Response:
        for attempt in range(self.max_retries + 1):
            self.limiter.acquire()
            try:
                resp = self._http.get(url)
            except httpx.TransportError as exc:
                if attempt == self.max_retries:
                    raise
                log.warning("transport error on %s: %s (retry %d)", url, exc, attempt + 1)
                self._sleep(min(2 ** attempt, 60))
                continue
            if resp.status_code == 404:
                raise NotFound(url)
            if resp.status_code in RETRY_STATUSES or _is_rate_limited_403(resp):
                if attempt == self.max_retries:
                    resp.raise_for_status()
                wait = min(2 ** attempt * 5, 600)
                log.warning("SEC returned %s for %s, backing off %ss", resp.status_code, url, wait)
                self._sleep(wait)
                continue
            resp.raise_for_status()
            return resp
        raise RuntimeError("unreachable")

    def close(self) -> None:
        self._http.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def _is_rate_limited_403(resp: httpx.Response) -> bool:
    return resp.status_code == 403 and "Request Rate Threshold Exceeded" in resp.text
