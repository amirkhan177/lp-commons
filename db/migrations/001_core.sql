-- Core schema: public LP / fund entities, people, roles, Form D filings,
-- plus private per-user network tables (never exported in the public dataset).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Organizations: LPs, funds, GP firms, companies.
CREATE TABLE entities (
    id                   BIGSERIAL PRIMARY KEY,
    type                 TEXT NOT NULL CHECK (type IN (
                             'lp_institution', 'family_office', 'ria', 'fof', 'foundation',
                             'pension', 'vc_fund', 'gp_firm', 'company')),
    name                 TEXT NOT NULL,
    name_normalized      TEXT NOT NULL,
    aliases              TEXT[] NOT NULL DEFAULT '{}',
    cik                  BIGINT UNIQUE,
    crd                  BIGINT UNIQUE,
    ein                  TEXT UNIQUE,
    city                 TEXT,
    state                TEXT,
    country              TEXT,
    jurisdiction         TEXT,
    entity_form          TEXT,          -- e.g. "Limited Partnership"
    aum_usd              NUMERIC,
    lp_type              TEXT,
    mandate              JSONB,
    emerging_mgr_program BOOLEAN,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX entities_type_idx ON entities (type);
CREATE INDEX entities_name_trgm_idx ON entities USING gin (name_normalized gin_trgm_ops);

-- People named in public filings. P0 dedupes on (normalized name, state);
-- proper cross-source entity resolution lands in P1.
CREATE TABLE people (
    id              BIGSERIAL PRIMARY KEY,
    full_name       TEXT NOT NULL,
    name_normalized TEXT NOT NULL,
    first_name      TEXT,
    middle_name     TEXT,
    last_name       TEXT,
    city            TEXT,
    state           TEXT NOT NULL DEFAULT '',
    linkedin_url    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name_normalized, state)
);
CREATE INDEX people_name_trgm_idx ON people USING gin (name_normalized gin_trgm_ops);

-- One row per Form D / D/A submission for funds we keep (VC + fund-of-funds).
CREATE TABLE formd_filings (
    accession_number      TEXT PRIMARY KEY,
    entity_id             BIGINT NOT NULL REFERENCES entities (id),
    cik                   BIGINT NOT NULL,
    submission_type       TEXT NOT NULL,             -- D or D/A
    filed_at              DATE,
    is_amendment          BOOLEAN NOT NULL DEFAULT false,
    previous_accession    TEXT,
    industry_group        TEXT,
    investment_fund_type  TEXT,
    fund_category         TEXT NOT NULL CHECK (fund_category IN ('vc', 'fof')),
    is_40act              BOOLEAN,
    federal_exemptions    TEXT[] NOT NULL DEFAULT '{}',  -- 06b, 06c, 3C.1, 3C.7 ...
    date_of_first_sale    DATE,
    first_sale_yet_to_occur BOOLEAN,
    total_offering_amount NUMERIC,
    offering_indefinite   BOOLEAN NOT NULL DEFAULT false,
    total_amount_sold     NUMERIC,
    total_remaining       NUMERIC,
    minimum_investment    NUMERIC,
    num_investors         INTEGER,
    has_non_accredited    BOOLEAN,
    num_non_accredited    INTEGER,
    sales_commissions     NUMERIC,
    finders_fees          NUMERIC,
    source                TEXT NOT NULL CHECK (source IN ('bulk', 'xml')),
    source_url            TEXT NOT NULL,
    ingested_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX formd_filings_entity_idx ON formd_filings (entity_id, filed_at);
CREATE INDEX formd_filings_filed_idx ON formd_filings (filed_at);

-- Person <-> entity relationships, with provenance.
CREATE TABLE roles (
    id               BIGSERIAL PRIMARY KEY,
    person_id        BIGINT NOT NULL REFERENCES people (id),
    entity_id        BIGINT NOT NULL REFERENCES entities (id),
    relationships    TEXT[] NOT NULL DEFAULT '{}',   -- Executive Officer, Director, Promoter
    title            TEXT,
    started_on       DATE,
    ended_on         DATE,
    source           TEXT NOT NULL,                  -- formd, adv, irs990, ...
    source_ref       TEXT NOT NULL,                  -- accession number etc.
    source_url       TEXT,
    filed_at         DATE,
    UNIQUE (person_id, entity_id, source, source_ref)
);
CREATE INDEX roles_entity_idx ON roles (entity_id);

-- Known LP -> fund commitments (public pension reports, community submissions).
CREATE TABLE commitments (
    id            BIGSERIAL PRIMARY KEY,
    lp_entity_id  BIGINT NOT NULL REFERENCES entities (id),
    fund_entity_id BIGINT NOT NULL REFERENCES entities (id),
    amount_usd    NUMERIC,
    vintage       SMALLINT,
    source        TEXT NOT NULL,
    source_url    TEXT,
    reported_at   DATE,
    UNIQUE (lp_entity_id, fund_entity_id, source)
);

-- Latest Form D snapshot per fund.
CREATE VIEW fund_latest_offering AS
SELECT DISTINCT ON (f.entity_id)
    e.id AS entity_id, e.name, e.cik, e.state, f.fund_category,
    f.accession_number, f.filed_at, f.total_offering_amount, f.offering_indefinite,
    f.total_amount_sold, f.num_investors, f.minimum_investment, f.federal_exemptions,
    f.date_of_first_sale
FROM formd_filings f
JOIN entities e ON e.id = f.entity_id
ORDER BY f.entity_id, f.filed_at DESC NULLS LAST, f.accession_number DESC;

-- ---------------------------------------------------------------------------
-- Private, per-workspace network data. Never included in dataset exports.
-- ---------------------------------------------------------------------------
CREATE TABLE workspaces (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_contacts (
    id              BIGSERIAL PRIMARY KEY,
    workspace_id    BIGINT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    first_name      TEXT,
    last_name       TEXT,
    linkedin_url    TEXT,
    email           TEXT,
    company         TEXT,
    position        TEXT,
    connected_on    DATE,
    enrichment      JSONB,           -- Clay payload
    enriched_at     TIMESTAMPTZ,
    matched_person_id BIGINT REFERENCES people (id),
    match_confidence REAL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, linkedin_url)
);

CREATE TABLE user_edges (
    id           BIGSERIAL PRIMARY KEY,
    workspace_id BIGINT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    contact_id   BIGINT NOT NULL REFERENCES user_contacts (id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,      -- linkedin, coinvestor, portfolio_founder, ...
    strength     REAL NOT NULL DEFAULT 0.5,
    evidence     JSONB,
    UNIQUE (workspace_id, contact_id, kind)
);

-- Pipeline bookkeeping (completed bulk quarters, processed daily indexes).
CREATE TABLE ingest_state (
    source     TEXT NOT NULL,
    key        TEXT NOT NULL,
    status     TEXT NOT NULL,       -- done, missing
    detail     JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source, key)
);
