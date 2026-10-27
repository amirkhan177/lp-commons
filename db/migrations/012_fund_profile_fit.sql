-- The emerging GP's own fund profile (drafted from their website/deck, confirmed by them), their
-- optional OpenRouter key, and thesis-fit scores for funds-of-funds and peer funds. Private data.

ALTER TABLE integrations DROP CONSTRAINT integrations_provider_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_provider_check
    CHECK (provider IN ('google', 'linkedin', 'openrouter'));

CREATE TABLE fund_profile (
    workspace_id     BIGINT PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
    fund_name        TEXT,
    website          TEXT,
    summary          TEXT,                       -- thesis in the GP's words (or the drafted version)
    sectors          TEXT[] NOT NULL DEFAULT '{}',
    stages           TEXT[] NOT NULL DEFAULT '{}',
    geographies      TEXT[] NOT NULL DEFAULT '{}',
    fund_number      SMALLINT,
    target_size      NUMERIC,
    check_min        NUMERIC,
    check_max        NUMERIC,
    lp_types         TEXT[] NOT NULL DEFAULT '{}',
    keywords         TEXT[] NOT NULL DEFAULT '{}',
    own_entity_id    BIGINT REFERENCES entities (id),   -- the GP's own fund in the Form D data
    draft            JSONB,                      -- last draft as produced, for reference
    draft_source     TEXT CHECK (draft_source IN ('llm', 'keywords', 'manual')),
    confirmed_at     TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fund_fit (
    workspace_id BIGINT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    entity_id    BIGINT NOT NULL REFERENCES entities (id),
    kind         TEXT NOT NULL CHECK (kind IN ('fof', 'peer')),
    score        SMALLINT NOT NULL,              -- 0..100
    reasons      TEXT[] NOT NULL DEFAULT '{}',
    llm_note     TEXT,                           -- one-line explanation from the re-rank, if any
    computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, entity_id)
);
CREATE INDEX fund_fit_rank_idx ON fund_fit (workspace_id, kind, score DESC);

CREATE TABLE fit_runs (
    id           BIGSERIAL PRIMARY KEY,
    workspace_id BIGINT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    status       TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
    stats        JSONB,
    error        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ
);
