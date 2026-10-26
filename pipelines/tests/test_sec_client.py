import httpx
import pytest

from lpmap.config import ConfigError
from lpmap.sec_client import NotFound, RateLimiter, SecClient

UA = "OpenPitchBook test@example.com"


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def now(self) -> float:
        return self.t

    def sleep(self, s: float) -> None:
        self.t += s


def test_rate_limiter_never_exceeds_10_in_any_second():
    clock = FakeClock()
    limiter = RateLimiter(10, clock=clock.now, sleep=clock.sleep)
    stamps = []
    for _ in range(55):
        limiter.acquire()
        stamps.append(clock.t)
    for i, t in enumerate(stamps):
        in_window = [s for s in stamps[i:] if s - t < 1.0]
        assert len(in_window) <= 10
    assert stamps[-1] >= 5.0  # 55 requests need at least 5 full seconds


def test_rate_limiter_hard_caps_configured_rate_at_10():
    assert RateLimiter(50).max == 10
    assert RateLimiter(4).max == 4


def test_user_agent_requires_contact_email():
    with pytest.raises(ConfigError):
        SecClient("OpenPitchBook")


def _client(handler, **kw):
    sleeps = []
    clock = FakeClock()
    client = SecClient(UA, transport=httpx.MockTransport(handler), sleep=sleeps.append,
                       limiter=RateLimiter(10, clock=clock.now, sleep=clock.sleep), **kw)
    return client, sleeps


def test_sends_user_agent_and_returns_body():
    seen = {}

    def handler(req):
        seen["ua"] = req.headers["user-agent"]
        return httpx.Response(200, text="ok")

    client, _ = _client(handler)
    assert client.get("https://www.sec.gov/x").text == "ok"
    assert seen["ua"] == UA


def test_404_raises_not_found():
    client, _ = _client(lambda req: httpx.Response(404))
    with pytest.raises(NotFound):
        client.get("https://www.sec.gov/missing")


@pytest.mark.parametrize("first", [
    httpx.Response(429),
    httpx.Response(403, text="<h1>Request Rate Threshold Exceeded</h1>"),
    httpx.Response(503),
])
def test_backs_off_and_retries_on_rate_limit(first):
    calls = []

    def handler(req):
        calls.append(1)
        return first if len(calls) == 1 else httpx.Response(200, text="ok")

    client, sleeps = _client(handler)
    assert client.get("https://www.sec.gov/x").text == "ok"
    assert len(calls) == 2 and sleeps == [5]


def test_s3_access_denied_403_means_missing_file():
    body = ('<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>AccessDenied</Code>'
            '<Message>Access Denied</Message></Error>')
    client, sleeps = _client(lambda req: httpx.Response(403, text=body))
    with pytest.raises(NotFound):
        client.get("https://www.sec.gov/Archives/edgar/daily-index/2026/QTR4/master.20261012.idx")
    assert sleeps == []


def test_plain_403_is_not_retried():
    client, _ = _client(lambda req: httpx.Response(403, text="Undeclared Automated Tool"))
    with pytest.raises(httpx.HTTPStatusError):
        client.get("https://www.sec.gov/x")


def test_gives_up_after_max_retries():
    client, sleeps = _client(lambda req: httpx.Response(429), max_retries=2)
    with pytest.raises(httpx.HTTPStatusError):
        client.get("https://www.sec.gov/x")
    assert len(sleeps) == 2
