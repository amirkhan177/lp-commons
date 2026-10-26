# OpenSource LP Map

Open-source LP database and warm-intro connection mapper for emerging VC fund managers.
Built from free public filings, starting with SEC Form D.

> Status: P0 — Postgres schema + Form D ingest service. Web app, LinkedIn/Clay import and
> intro-path finding come in later phases.

## What's here

```
db/migrations/        Postgres schema (entities, people, roles, Form D filings, private network tables)
pipelines/            Python ingest service (`lpmap` CLI)
  src/lpmap/sec_client.py     SEC HTTP client, hard-capped at 10 requests/second
  src/lpmap/sources/formd.py  Form D bulk TSV + daily index + primary_doc.xml parsers
  src/lpmap/pipeline.py       sync: backfill bulk quarters, then catch up daily filings
docker-compose.yml    Local Postgres + scraper
```

## Data: what Form D does and doesn't tell you

Form D names the **fund** (issuer), its **related persons** (GP principals, directors,
promoters), offering size, amount sold, number of investors and minimum investment.
It does **not** name LPs. We keep only:

- **VC funds** — industry group "Pooled Investment Fund" + fund type "Venture Capital Fund"
- **Funds of funds** — pooled investment funds whose name says "fund of funds" / "FoF"
  (Form D has no FoF checkbox)

GP entities listed as related persons (e.g. "Acme GP, LLC" / "N/A") are not stored as people.

## SEC fair access

Every request sends `SEC_USER_AGENT` (must contain a contact email — SEC returns 403
without one) and goes through one limiter: at most 10 requests in any rolling second.
429s and SEC's "Request Rate Threshold Exceeded" 403 back off exponentially.
See https://www.sec.gov/search-filings/edgar-application-programming-interfaces

## Run locally

```bash
cp .env.example .env   # set SEC_USER_AGENT
docker compose up db -d
cd pipelines && uv sync
uv run lpmap sync --max-quarters 2   # small first run
uv run lpmap status
```

Commands: `lpmap migrate | sync | quarter 2025q2 | day 2025-10-01 | status`.

## Tests

```bash
cd pipelines
uv run pytest                                        # unit tests
TEST_DATABASE_URL=postgresql://... uv run pytest     # + Postgres integration (wipes that DB)
```

## Deploy (Railway)

One project with a Postgres service and an `edgar-scraper` service. Scraper service settings:

| Setting | Value |
|---|---|
| Builder | Dockerfile, path `pipelines/Dockerfile` (build context: repo root) |
| Start command | `lpmap sync` |
| Cron schedule | `15 */6 * * *` |
| Restart policy | Never |

Deploy with `railway up --service edgar-scraper` from the repo root. Each cron run migrates,
backfills any missing bulk quarters, then processes new daily indexes. Every step is
recorded in `ingest_state`, so runs are resumable and idempotent.

Scraper variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `SEC_USER_AGENT`,
optional `FORMD_BACKFILL_FROM` (default `2009q1`).

## License

Code: MIT. Compiled dataset: ODbL.
