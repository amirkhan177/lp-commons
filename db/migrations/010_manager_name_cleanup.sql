-- Display-side cleanup for manager names loaded before the pipeline learned to strip role labels
-- that filers typed into the name field ("General Partner Acme GP, LLC", "[none] Acme GP").
CREATE OR REPLACE VIEW fund_manager_names AS
SELECT DISTINCT ON (fm.fund_entity_id, fm.manager_entity_id)
       fm.fund_entity_id, fm.manager_entity_id,
       regexp_replace(m.name, '^((\[none\]|\(none\)|general\s+partner|management\s+company|managing\s+member|investment\s+manager)\s+)+', '', 'i')
           AS manager_name,
       m.name_normalized AS manager_key,
       fm.role, fm.clarification, fm.source_url, fm.filed_at
FROM fund_managers fm JOIN entities m ON m.id = fm.manager_entity_id
ORDER BY fm.fund_entity_id, fm.manager_entity_id, fm.filed_at DESC NULLS LAST;
