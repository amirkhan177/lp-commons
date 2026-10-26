-- Raise status and remaining-to-raise per fund, for filtering.
--
-- raise_status:
--   raising        filed in the last 18 months and the offering still has room (or is open-ended)
--   fresh_capital  fully raised and filed in the last 24 months: an estimate of funds with
--                  uninvested capital ("dry powder"), which Form D itself doesn't report
--   quiet          everything else
-- remaining_to_raise: the filing's "total remaining", else goal minus sold; NULL if open-ended.

CREATE OR REPLACE VIEW fund_latest_offering AS
SELECT DISTINCT ON (f.entity_id)
    e.id AS entity_id, e.name, e.cik, e.state, f.fund_category,
    f.accession_number, f.filed_at, f.total_offering_amount, f.offering_indefinite,
    f.total_amount_sold, f.num_investors, f.minimum_investment, f.federal_exemptions,
    f.date_of_first_sale, f.total_remaining
FROM formd_filings f
JOIN entities e ON e.id = f.entity_id
ORDER BY f.entity_id, f.filed_at DESC NULLS LAST, f.accession_number DESC;

CREATE OR REPLACE VIEW fund_profiles AS
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
    l.accession_number AS latest_accession,
    CASE WHEN l.offering_indefinite THEN NULL
         ELSE COALESCE(l.total_remaining, GREATEST(l.total_offering_amount - l.total_amount_sold, 0)) END
        AS remaining_to_raise,
    CASE
        WHEN max(f.filed_at) >= (CURRENT_DATE - INTERVAL '18 months')
             AND (l.offering_indefinite OR l.total_offering_amount IS NULL
                  OR COALESCE(l.total_remaining, l.total_offering_amount - l.total_amount_sold) > 0)
            THEN 'raising'
        WHEN max(f.filed_at) >= (CURRENT_DATE - INTERVAL '24 months')
             AND l.total_offering_amount > 0 AND l.total_amount_sold >= l.total_offering_amount
            THEN 'fresh_capital'
        ELSE 'quiet'
    END AS raise_status
FROM entities e
JOIN formd_filings f ON f.entity_id = e.id
JOIN fund_latest_offering l ON l.entity_id = e.id
WHERE e.type IN ('vc_fund', 'fof')
GROUP BY e.id, l.total_offering_amount, l.offering_indefinite, l.total_amount_sold, l.num_investors,
         l.minimum_investment, l.federal_exemptions, l.accession_number, l.total_remaining;
