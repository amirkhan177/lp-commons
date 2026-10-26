# LP Commons

[![License: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](LICENSE)
[![Data: ODbL](https://img.shields.io/badge/data-ODbL%201.0-green.svg)](DATA_LICENSE.md)

Open-source LP database and warm-intro connection mapper for emerging VC fund managers.
Built from free public filings, starting with SEC Form D.

> [!IMPORTANT]
> **Not investment, legal, or tax advice, and not an offer or solicitation of any security.**
> Data comes from public filings, is self-reported and machine-classified, and may be wrong —
> verify against the linked source before relying on it. You are responsible for complying with
> securities laws (e.g. Reg D general-solicitation rules) when contacting investors.
> Provided **as is, without warranty or liability**. Not affiliated with the SEC or
> any other organization named here. Read the full **[Disclaimer](DISCLAIMER.md)**.

> Status: Form D ingest service + path mapper web app (LinkedIn import, deterministic matching,
> intro paths). Clay enrichment, bring-your-own Claude matching, and more LP sources come next.

## What's here

```
db/migrations/        Postgres schema (entities, people, roles, Form D filings, private network tables)
pipelines/            Python ingest service (`lpmap` CLI)
  src/lpmap/sec_client.py     SEC HTTP client, hard-capped at 10 requests/second
  src/lpmap/sources/formd.py  Form D bulk TSV + daily index + primary_doc.xml parsers
  src/lpmap/pipeline.py       sync: backfill bulk quarters, then catch up daily filings
apps/web/             Next.js path mapper (login, LinkedIn import, intro paths + graph)
  lib/graph/paths.ts          pure path finder (scored, best path per contact)
  lib/graph/build.ts          subgraph around a target fund from filings + your network
  lib/import.ts               Connections.csv import and contact <-> filing-person matching
docker-compose.yml    Local Postgres + scraper
```

## Path mapper

Upload your LinkedIn `Connections.csv`, search a fund, and get ranked warm-intro paths:

- **You → connection → fund**: your connection works at the fund's firm (LinkedIn company matches
  the firm name on its Form D).
- **You → connection = person in filings → fund**: your connection is named on the fund's Form D.
- **You → connection → co-fund → GP → fund**: your connection is named on another fund that shares
  a related person with the target.

Scores multiply hop weights: how recently you connected, how confident the name match is, and the
relationship type. Every hop links to its evidence (the Form D filing or your LinkedIn data).
Name matches are deterministic in v1: same name **and** firm = matched; same unique name only =
"possible" (review on *Your network*). Your imported network stays in your instance's private
tables and is never exported.

### Background mapping agent

After you import LinkedIn connections, sync Google, or review a match, a mapping run is queued and
processed in the background (Postgres-backed queue, one run at a time, resumed after restarts). It
computes your best intro path to **every active fund** (vintage ≥ 2016, non-SPV) at once and writes
the results to *Reach*, then notifies you in-app — and by email if Resend is configured.

### Google contacts & calendar (optional)

Read-only OAuth (contacts, "other contacts" = people you've emailed, calendar events). Only names,
emails, organizations and attendee lists are fetched — never event titles or contents. People you
have actually met rank higher than address-book entries. The refresh token is AES-256-GCM
encrypted at rest; *Disconnect* revokes it and deletes all Google-sourced contacts. For a hosted
multi-user instance, Google requires app verification for these scopes.

### LinkedIn agent (optional, opt-in)

`apps/linkedin-agent` is a separate service (Playwright + Chromium). Off unless the operator sets
`LINKEDIN_AGENT_ENABLED=true`; each user must tick three consent boxes. The user signs in to
LinkedIn themselves in a live-view window (CDP screencast; their own password and 2FA), then the
agent reads their 1st-degree connections and each connection's Experience section — one profile
every 20–50 s, capped per day (default 120, max 200) — and the mapper uses that work history
(current job 0.7, past job 0.5). Any login wall, checkpoint, or CAPTCHA stops the agent and asks
the user to sign in again; it is never bypassed. Sessions are encrypted with
`LINKEDIN_SESSION_KEY`, which only the agent holds (per-workspace HKDF key + workspace-bound
AES-GCM), so the web app and database only see ciphertext.

**This automates a LinkedIn account, which LinkedIn's User Agreement prohibits; accounts can be
restricted.** See [DISCLAIMER.md](DISCLAIMER.md) §5. Test it against the bundled fake site
(`pnpm fake-linkedin`, `LINKEDIN_BASE_URL=http://localhost:4010`), not a real account.

Run locally: set `DATABASE_URL`, `ADMIN_PASSWORD`, `SESSION_SECRET` in `apps/web/.env.local`, then
`cd apps/web && pnpm install && pnpm dev`. Tests: `pnpm test`.

## Data: what Form D does and doesn't tell you

Form D names the **fund** (issuer), its **related persons** (GP principals, directors,
promoters), offering size, amount sold, number of investors and minimum investment.
It does **not** name LPs. We keep only:

- **VC funds** — industry group "Pooled Investment Fund" + fund type "Venture Capital Fund"
- **Funds of funds** — pooled investment funds whose name says "fund of funds" / "FoF"
  (Form D has no FoF checkbox)

GP entities listed as related persons (e.g. "Acme GP, LLC" / "N/A") are not stored as people.

Focus: **active funds since 2016** — the `active_funds` view (vintage ≥ 2016, and a Form D / D/A
filed in the last 18 months; issuers must amend annually while still raising). Backfill starts at
2016q1. Bulk zip URLs are read from SEC's
[Form D data sets page](https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets),
since paths differ by quarter.

Family offices and CVCs don't identify themselves on Form D; they come from other sources in P1
(13F / Form ADV for family offices, curated CVC list matched to corporate parents).

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
optional `FORMD_BACKFILL_FROM` (default `2016q1`).

The `web` service builds `apps/web/Dockerfile` (root directory `apps/web`) with variables
`DATABASE_URL=${{Postgres.DATABASE_URL}}` (private network only — the database has no public
endpoint), `ADMIN_PASSWORD`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `APP_URL`, and optionally the
Google and Resend variables from `.env.example`.

## Project docs

| | |
|---|---|
| [DISCLAIMER.md](DISCLAIMER.md) | Not advice; data accuracy; no warranty; limitation of liability |
| [PRIVACY.md](PRIVACY.md) | What personal data is held, and how to request correction or removal |
| [SECURITY.md](SECURITY.md) | Reporting vulnerabilities privately |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Dev setup, data-source rules, PR checklist |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Contributor Covenant 2.1 |

## License

- Code: [MIT](LICENSE)
- Compiled dataset: [ODbL 1.0](DATA_LICENSE.md)
