-- Background mapping agent: runs, per-fund reach results, notifications, and Google as a second
-- private network source. All tables here are private, per-workspace data (never exported).

-- Contacts can now come from more than LinkedIn.
ALTER TABLE user_contacts
    ADD COLUMN source TEXT NOT NULL DEFAULT 'linkedin' CHECK (source IN ('linkedin', 'google')),
    ADD COLUMN meetings INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN last_met_on DATE;
CREATE UNIQUE INDEX user_contacts_google_email_idx
    ON user_contacts (workspace_id, lower(email)) WHERE source = 'google';

CREATE TABLE integrations (
    workspace_id    BIGINT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    provider        TEXT NOT NULL CHECK (provider IN ('google')),
    account_email   TEXT,
    refresh_token   TEXT NOT NULL,        -- AES-256-GCM encrypted (ENCRYPTION_KEY), never plaintext
    scopes          TEXT NOT NULL,
    last_synced_at  TIMESTAMPTZ,
    last_sync_stats JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, provider)
);

CREATE TABLE mapping_runs (
    id           BIGSERIAL PRIMARY KEY,
    workspace_id BIGINT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    trigger      TEXT NOT NULL,           -- linkedin_import, google_sync, match_review, manual
    status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
    stats        JSONB,
    error        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at   TIMESTAMPTZ,
    finished_at  TIMESTAMPTZ
);
CREATE INDEX mapping_runs_ws_idx ON mapping_runs (workspace_id, created_at DESC);

-- Best intro path per reachable fund, replaced wholesale by each successful run.
CREATE TABLE fund_reach (
    workspace_id   BIGINT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    entity_id      BIGINT NOT NULL REFERENCES entities (id),
    run_id         BIGINT NOT NULL REFERENCES mapping_runs (id) ON DELETE CASCADE,
    best_score     REAL NOT NULL,
    contact_count  INTEGER NOT NULL,      -- distinct people of yours with a path
    best_path      JSONB NOT NULL,        -- [{id, kind, label}] nodes + edges with evidence
    PRIMARY KEY (workspace_id, entity_id)
);
CREATE INDEX fund_reach_score_idx ON fund_reach (workspace_id, best_score DESC);

CREATE TABLE notifications (
    id           BIGSERIAL PRIMARY KEY,
    workspace_id BIGINT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    body         TEXT,
    url          TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at      TIMESTAMPTZ
);
CREATE INDEX notifications_unread_idx ON notifications (workspace_id) WHERE read_at IS NULL;
