-- LinkedIn agent (opt-in): an encrypted browser session per workspace, and each connection's work
-- history so past firms can corroborate matches and create intro paths. Private data only.

ALTER TABLE integrations DROP CONSTRAINT integrations_provider_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_provider_check CHECK (provider IN ('google', 'linkedin'));
ALTER TABLE integrations
    ADD COLUMN status TEXT NOT NULL DEFAULT 'connected'
        CHECK (status IN ('connected', 'needs_login', 'challenge', 'paused')),
    ADD COLUMN status_detail TEXT;

-- One row per company in a connection's Experience section (roles at the same company merged).
CREATE TABLE user_contact_experience (
    contact_id       BIGINT NOT NULL REFERENCES user_contacts (id) ON DELETE CASCADE,
    position         SMALLINT NOT NULL,          -- order on the profile, 0 = most recent
    company          TEXT NOT NULL,
    company_firm_key TEXT GENERATED ALWAYS AS (lpc_firm_key(company)) STORED,
    titles           TEXT[] NOT NULL DEFAULT '{}',
    started          TEXT,                       -- as shown, e.g. "Jan 2019" or "2019"
    ended            TEXT,                       -- NULL when current
    is_current       BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (contact_id, position)
);
CREATE INDEX user_contact_experience_firm_idx ON user_contact_experience (company_firm_key);

ALTER TABLE user_contacts ADD COLUMN headline TEXT;

-- One canonical profile URL form for CSV imports and the agent: https://www.linkedin.com/in/<slug>
UPDATE user_contacts SET linkedin_url = lower(regexp_replace(linkedin_url, '/+$', ''))
WHERE linkedin_url ~ '^https://(www\.)?linkedin\.com/in/';
