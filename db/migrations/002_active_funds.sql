-- Per-fund rollup of Form D history, plus the "active since 2016" slice the product focuses on.
--
-- vintage: earliest date of first sale (Form D item 7, carried on amendments) or filing date.
-- active:  filed a Form D / D/A in the last 18 months. Issuers must amend annually while an
--          offering continues, so 12 months + 6 months grace.

-- Corporate venture capital arms are an LP/co-investor type of their own.
ALTER TABLE entities DROP CONSTRAINT entities_type_check;
ALTER TABLE entities ADD CONSTRAINT entities_type_check CHECK (type IN (
    'lp_institution', 'family_office', 'ria', 'fof', 'foundation', 'pension', 'cvc',
    'vc_fund', 'gp_firm', 'company'));

CREATE VIEW fund_profiles AS
SELECT
    e.id AS entity_id,
    e.name,
    e.cik,
    e.type,
    e.city,
    e.state,
    LEAST(min(f.date_of_first_sale), min(f.filed_at)) AS vintage_date,
    EXTRACT(YEAR FROM LEAST(min(f.date_of_first_sale), min(f.filed_at)))::int AS vintage,
    min(f.filed_at) AS first_filed_at,
    max(f.filed_at) AS last_filed_at,
    count(*) AS filing_count,
    max(f.filed_at) >= (CURRENT_DATE - INTERVAL '18 months') AS is_active,
    l.total_offering_amount,
    l.offering_indefinite,
    l.total_amount_sold,
    l.num_investors,
    l.minimum_investment,
    l.federal_exemptions,
    l.accession_number AS latest_accession
FROM entities e
JOIN formd_filings f ON f.entity_id = e.id
JOIN fund_latest_offering l ON l.entity_id = e.id
WHERE e.type IN ('vc_fund', 'fof')
GROUP BY e.id, l.total_offering_amount, l.offering_indefinite, l.total_amount_sold, l.num_investors,
         l.minimum_investment, l.federal_exemptions, l.accession_number;

CREATE VIEW active_funds AS
SELECT * FROM fund_profiles
WHERE is_active AND vintage >= 2016;
