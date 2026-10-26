# Contributing to LP Commons

Thanks for helping. Issues, data fixes, new data sources, and code are all welcome.

## Ground rules

- **Public data only.** New sources for the public dataset must be lawfully and publicly
  available (e.g. government filings, published pension reports). No scraping of sites whose
  terms forbid it, no paywalled or leaked data, and no personal contact details (emails, phones,
  home addresses) in the public dataset.
- **LinkedIn agent limits are fixed.** The opt-in agent (`apps/linkedin-agent`) works only on a
  consenting user's own session and own connections, read-only, rate-limited, and stops at any
  security check. Contributions that add CAPTCHA solving, fingerprint/stealth evasion, proxy
  rotation, messaging/invites, or crawling beyond the user's own connections won't be accepted.
- **Respect source rate limits.** All SEC requests go through `SecClient` (≤ 10 req/s). Don't
  bypass it.
- **Provenance on every fact.** Every row written from a source carries a `source_url` /
  `source_ref` back to the original document.
- **Private network data stays private.** Nothing from `user_contacts` / `user_edges` may flow
  into public exports or other workspaces.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development

```bash
cp .env.example .env            # set SEC_USER_AGENT to "Your Name you@example.com"
docker compose up db -d
cd pipelines && uv sync
uv run pytest                   # unit tests
docker compose exec db createdb -U lpmap lpmap_test
TEST_DATABASE_URL=postgresql://lpmap:lpmap@localhost:5432/lpmap_test uv run pytest   # + Postgres (wipes that DB)
```

- Add tests for parsers and classifiers using small fixtures in `pipelines/tests/fixtures`
  (synthetic or redacted — no real personal data beyond what is in public filings).
- Schema changes go in a new numbered file in `db/migrations/`; never edit an applied migration.
- Match the existing code style; keep functions small and idempotent.

## Pull requests

1. Fork, branch from `main`, keep the change focused.
2. Run the tests.
3. Fill in the PR template, including the data/privacy checklist.

## Licensing of contributions

By submitting a contribution you confirm that you have the right to submit it, and you agree
that it is licensed under the project's licenses: the [MIT License](LICENSE) for code and the
[ODbL](DATA_LICENSE.md) for data. You also agree that the [Disclaimer](DISCLAIMER.md)
applies to your contribution — contributors give no warranty and accept no liability for it.
