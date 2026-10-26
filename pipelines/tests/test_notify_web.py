import httpx

from lpmap import notify_web


def test_counts_only_ingested_filings():
    assert notify_web.new_filings_count({"quarters": {"2026q2": 12}, "days": {"2026-10-01": 3, "2026-10-12": None}}) == 15
    assert notify_web.new_filings_count({"quarters": {}, "days": {}}) == 0


def test_posts_with_secret_only_when_configured(monkeypatch):
    seen = []

    def handler(req: httpx.Request):
        seen.append((str(req.url), req.headers.get("x-agent-secret")))
        return httpx.Response(200, json={"ok": True})

    t = httpx.MockTransport(handler)
    monkeypatch.delenv("WEB_INTERNAL_URL", raising=False)
    assert notify_web.filings_updated(5, transport=t) is False
    monkeypatch.setenv("WEB_INTERNAL_URL", "http://web.railway.internal:8080/")
    monkeypatch.setenv("AGENT_SHARED_SECRET", "s3cret")
    assert notify_web.filings_updated(0, transport=t) is False
    assert notify_web.filings_updated(5, transport=t) is True
    assert seen == [("http://web.railway.internal:8080/api/internal/filings-updated", "s3cret")]


def test_failures_are_not_raised(monkeypatch):
    monkeypatch.setenv("WEB_INTERNAL_URL", "http://web")
    monkeypatch.setenv("AGENT_SHARED_SECRET", "s")
    t = httpx.MockTransport(lambda req: httpx.Response(503))
    assert notify_web.filings_updated(3, transport=t) is False
