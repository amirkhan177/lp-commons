# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub:
**[Security → Report a vulnerability](../../security/advisories/new)**.

Include what you found, how to reproduce it, and what an attacker could do with it.
Maintainers aim to acknowledge reports within 7 days and will coordinate a fix and disclosure
timeline with you. This is a volunteer project: there is no bug bounty.

## Scope

In scope: the code in this repository (ingest pipelines, database schema, web app, and
integrations once they land), including anything that could expose one workspace's private
network data to another, leak API keys, or let the scraper exceed SEC fair-access limits.

Out of scope: third-party services (SEC EDGAR, Railway, Clay, Anthropic, GitHub) — report
those to their owners — and instances run by other operators.

## Operator checklist

If you deploy OpenPitchBook:

- Keep secrets (`DATABASE_URL`, `SEC_USER_AGENT`, Clay/Anthropic keys) in your host's secret
  store, never in the repo. `.env` is gitignored.
- Restrict database network access; use TLS.
- Rotate keys if you suspect exposure.
- Keep dependencies updated (`uv lock --upgrade`).

## Supported versions

Only the latest commit on `main` receives security fixes.
