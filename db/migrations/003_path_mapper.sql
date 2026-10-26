-- Path mapper support: firm keys for matching LinkedIn companies to funds, contact name keys,
-- match review state, and a default workspace.

-- "Equal Ventures Opportunity 2, LP" and LinkedIn company "Equal Ventures" both -> "equal ventures".
-- NULL for single-deal vehicles ("X, a Series of Y") and keys too short to match safely.
CREATE FUNCTION lpc_firm_key(name text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN name IS NULL OR name ~* 'a series of' THEN NULL ELSE (
        SELECT CASE WHEN length(k) >= 3 THEN k END
        FROM (SELECT btrim(regexp_replace(
                  regexp_replace(
                      ' ' || regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g') || ' ',
                      '\m(fund|funds|lp|l p|llc|l l c|ltd|limited|inc|the|series|opportunity|opportunities|'
                      || 'early|parallel|feeder|partnership|partners lp|co|investors|holdings|spv|'
                      || '[ivx]+|[0-9]+|[a-z])\M', ' ', 'g'),
                  '\s+', ' ', 'g')) AS k) t
    ) END
$$;

ALTER TABLE entities ADD COLUMN firm_key TEXT GENERATED ALWAYS AS (lpc_firm_key(name)) STORED;
CREATE INDEX entities_firm_key_idx ON entities (firm_key);
CREATE INDEX entities_firm_key_trgm_idx ON entities USING gin (firm_key gin_trgm_ops);

ALTER TABLE user_contacts
    ADD COLUMN name_key TEXT,
    ADD COLUMN company_firm_key TEXT GENERATED ALWAYS AS (lpc_firm_key(company)) STORED,
    ADD COLUMN match_status TEXT NOT NULL DEFAULT 'none'
        CHECK (match_status IN ('none', 'auto', 'possible', 'confirmed', 'rejected'));
CREATE INDEX user_contacts_name_key_idx ON user_contacts (workspace_id, name_key);
CREATE INDEX user_contacts_firm_key_idx ON user_contacts (workspace_id, company_firm_key);

INSERT INTO workspaces (id, name) VALUES (1, 'default') ON CONFLICT DO NOTHING;
SELECT setval('workspaces_id_seq', GREATEST((SELECT max(id) FROM workspaces), 1));
