-- Management companies and general partners named on Form D (as organization "related persons"),
-- linked to the funds they manage. Also: firm keys ignore management-company words so that
-- "Acme Management, LLC" and "Acme Fund II, L.P." share a firm.

CREATE OR REPLACE FUNCTION lpc_firm_key(name text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN name IS NULL OR name ~* 'a series of' THEN NULL ELSE (
        SELECT CASE WHEN length(k) >= 3 THEN k END
        FROM (SELECT btrim(regexp_replace(
                  regexp_replace(
                      ' ' || regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g') || ' ',
                      '\m(fund|funds|lp|l p|llc|l l c|ltd|limited|inc|the|series|opportunity|opportunities|'
                      || 'early|parallel|feeder|partnership|partners lp|co|investors|holdings|spv|'
                      || 'management|mgmt|manager|managers|advisors|advisers|advisor|adviser|gp|group|'
                      || '[ivx]+|[0-9]+|[a-z])\M', ' ', 'g'),
                  '\s+', ' ', 'g')) AS k) t
    ) END
$$;

-- Generated columns don't recompute when their function changes: rebuild them.
ALTER TABLE entities DROP COLUMN firm_key;
ALTER TABLE entities ADD COLUMN firm_key TEXT GENERATED ALWAYS AS (lpc_firm_key(name)) STORED;
CREATE INDEX entities_firm_key_idx ON entities (firm_key);
CREATE INDEX entities_firm_key_trgm_idx ON entities USING gin (firm_key gin_trgm_ops);

ALTER TABLE user_contacts DROP COLUMN company_firm_key;
ALTER TABLE user_contacts ADD COLUMN company_firm_key TEXT GENERATED ALWAYS AS (lpc_firm_key(company)) STORED;
CREATE INDEX user_contacts_firm_key_idx ON user_contacts (workspace_id, company_firm_key);

ALTER TABLE user_contact_experience DROP COLUMN company_firm_key;
ALTER TABLE user_contact_experience ADD COLUMN company_firm_key TEXT GENERATED ALWAYS AS (lpc_firm_key(company)) STORED;
CREATE INDEX user_contact_experience_firm_idx ON user_contact_experience (company_firm_key);

-- Manager organizations have no CIK on the fund's filing; dedupe them by normalized name.
CREATE UNIQUE INDEX entities_gp_firm_name_idx ON entities (name_normalized) WHERE type = 'gp_firm';

CREATE TABLE fund_managers (
    fund_entity_id    BIGINT NOT NULL REFERENCES entities (id),
    manager_entity_id BIGINT NOT NULL REFERENCES entities (id),
    role              TEXT NOT NULL CHECK (role IN ('manager', 'general_partner')),
    relationships     TEXT[] NOT NULL DEFAULT '{}',
    clarification     TEXT,
    source_ref        TEXT NOT NULL,           -- accession number
    source_url        TEXT,
    filed_at          DATE,
    PRIMARY KEY (fund_entity_id, manager_entity_id, source_ref)
);
CREATE INDEX fund_managers_manager_idx ON fund_managers (manager_entity_id);

-- Latest known managers per fund, for search and profiles.
CREATE VIEW fund_manager_names AS
SELECT DISTINCT ON (fm.fund_entity_id, fm.manager_entity_id)
       fm.fund_entity_id, fm.manager_entity_id, m.name AS manager_name, m.name_normalized AS manager_key,
       fm.role, fm.clarification, fm.source_url, fm.filed_at
FROM fund_managers fm JOIN entities m ON m.id = fm.manager_entity_id
ORDER BY fm.fund_entity_id, fm.manager_entity_id, fm.filed_at DESC NULLS LAST;
