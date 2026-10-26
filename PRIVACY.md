# Privacy

LP Commons works with two very different kinds of data. They are kept apart on purpose.

## 1. Public dataset (from public filings)

**What:** names, cities/states, and roles (e.g. "Executive Officer", "Promoter") of people
listed in public regulatory filings such as SEC Form D, together with the fund or organization
they are linked to and a link back to the original filing.

**What we never add to the public dataset:** personal email addresses, phone numbers, home
addresses, photos, social-media profiles, or anything from a user's private network import.

**Why:** to help emerging fund managers understand the public landscape of funds and investors.
This information is already published by the source agency; we organize it and link to it.

### Correction and removal requests

If you appear in the dataset and believe a record is wrong, misattributed to you, or should be
removed:

1. Open a **[data correction / removal request](../../issues/new?template=data_correction.yml)**.
   **Do not post personal contact details or ID documents in the issue** — it is public.
   Describe the record (fund name, filing link) and what is wrong.
2. If your request involves information you don't want public, open a private report instead
   via **[GitHub private reporting](../../security/advisories/new)** and say it is a privacy
   request.

Maintainers aim to respond within 30 days. Because the source filings are public government
records, we can correct how they are attributed or suppress a person's record from the
dataset, but we cannot change the original filing.

Removal applies to the dataset published from this repository. Copies made earlier by others,
and independent instances run by other operators, are outside our control.

## 2. Private network data (yours, never shared)

When you import your own network — for example a LinkedIn `Connections.csv` export, Clay
enrichment results, or notes on intros — that data:

- is stored only in **the database of the instance you use**;
- is scoped to your workspace and is **never** included in public dataset exports or shared
  with other workspaces;
- is sent to third-party services only when you turn on an integration that does so, using
  your own account (e.g. Clay for enrichment, the Anthropic API for matching). Those services'
  own privacy policies then apply.

You can delete your workspace's imported data at any time; deleting a workspace deletes its
contacts and edges (`ON DELETE CASCADE`).

## 3. If you run your own instance

You are the **data controller/operator** for that instance. That means you are responsible
for: having a lawful basis to process the personal data in it, securing it (including
database credentials and API keys), telling your users how their data is handled, and honoring
access, correction, and deletion requests under applicable law (e.g. GDPR, UK GDPR,
CCPA/CPRA). The maintainers of this repository do not receive or control data in your instance.

## 4. The code itself

The open-source code contains no analytics, tracking, or telemetry. Network requests go only
to the data sources and services you configure (e.g. `sec.gov`, your database, and any
integrations you enable).

See also [DISCLAIMER.md](DISCLAIMER.md).
