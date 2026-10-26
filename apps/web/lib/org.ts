import "server-only";
import { db, WORKSPACE_ID } from "./db";

export interface OrgFund {
  id: number;
  name: string;
  type: string;
  state: string | null;
  vintage: number | null;
  is_active: boolean | null;
  total_offering_amount: string | null;
  total_amount_sold: string | null;
  num_investors: number | null;
  last_filed_at: string | null;
  reach: number | null; // your best route strength, if any
}

export interface OrgManager { id: number; name: string; role: "manager" | "general_partner"; url: string | null }

export interface Member {
  id: number;
  name: string;
  state: string;
  relationships: string[];
  titles: string[];
  funds: number;
  // Present only when this person is one of your own connections (private to your workspace).
  contact: {
    name: string; headline: string | null; company: string | null; position: string | null;
    linkedin_url: string | null; photo_url: string | null; match_status: string;
  } | null;
}

export interface Filing {
  accession_number: string; submission_type: string; filed_at: string | null; total_offering_amount: string | null;
  offering_indefinite: boolean; total_amount_sold: string | null; num_investors: number | null; source_url: string;
}

export interface Org {
  id: number;
  kind: "fund" | "manager";
  name: string;
  cik: number | null;
  city: string | null;
  state: string | null;
  jurisdiction: string | null;
  entity_form: string | null;
  aliases: string[];
  fund: OrgFund | null;        // this fund (kind = fund)
  managers: OrgManager[];      // its management company / GPs (kind = fund)
  funds: OrgFund[];            // managed funds (manager) or sister funds (fund)
  members: Member[];
  filings: Filing[];
}

const FUND_COLS = `fp.entity_id AS id, fp.name, fp.type, fp.state, fp.vintage, fp.is_active, fp.total_offering_amount,
  fp.total_amount_sold, fp.num_investors, fp.last_filed_at::text,
  (SELECT best_score FROM fund_reach r WHERE r.workspace_id = ${WORKSPACE_ID} AND r.entity_id = fp.entity_id) AS reach`;

export async function getOrg(id: number): Promise<Org | null> {
  const pool = db();
  const e = (await pool.query<{ id: number; type: string; name: string; cik: number | null; city: string | null;
    state: string | null; jurisdiction: string | null; entity_form: string | null; aliases: string[]; firm_key: string | null }>(
    `SELECT id, type, name, cik, city, state, jurisdiction, entity_form, aliases, firm_key FROM entities WHERE id = $1`,
    [id])).rows[0];
  if (!e || !["vc_fund", "fof", "gp_firm"].includes(e.type)) return null;
  const kind = e.type === "gp_firm" ? "manager" : "fund";

  let fund: OrgFund | null = null;
  let managers: OrgManager[] = [];
  let funds: OrgFund[] = [];
  let fundIds: number[];
  let filings: Filing[] = [];

  if (kind === "fund") {
    fund = (await pool.query<OrgFund>(`SELECT ${FUND_COLS} FROM fund_profiles fp WHERE fp.entity_id = $1`, [id])).rows[0] ?? null;
    managers = (await pool.query<OrgManager>(
      `SELECT manager_entity_id AS id, manager_name AS name, role, source_url AS url FROM fund_manager_names
       WHERE fund_entity_id = $1 ORDER BY role DESC, manager_name`, [id])).rows;
    // Sister funds: same management company or GP, else same firm name.
    funds = (await pool.query<OrgFund>(
      `SELECT ${FUND_COLS} FROM fund_profiles fp
       WHERE fp.entity_id <> $1 AND fp.entity_id IN (
         SELECT fund_entity_id FROM fund_managers WHERE manager_entity_id = ANY($2)
         UNION SELECT id FROM entities WHERE $3::text IS NOT NULL AND firm_key = $3)
       ORDER BY fp.vintage DESC NULLS LAST, fp.name LIMIT 60`,
      [id, managers.map((m) => m.id), e.firm_key])).rows;
    fundIds = [id];
    filings = (await pool.query<Filing>(
      `SELECT accession_number, submission_type, filed_at::text, total_offering_amount, offering_indefinite,
              total_amount_sold, num_investors, source_url
       FROM formd_filings WHERE entity_id = $1 ORDER BY filed_at DESC NULLS LAST LIMIT 40`, [id])).rows;
  } else {
    funds = (await pool.query<OrgFund>(
      `SELECT ${FUND_COLS} FROM fund_profiles fp
       WHERE fp.entity_id IN (SELECT fund_entity_id FROM fund_managers WHERE manager_entity_id = $1)
       ORDER BY fp.vintage DESC NULLS LAST, fp.name LIMIT 200`, [id])).rows;
    fundIds = funds.map((f) => f.id);
  }

  // Filings list the same person under different states; within one organization's funds a
  // shared normalized name is the same person, so merge those rows.
  const members = (await pool.query<Member>(
    `SELECT min(p.id) AS id, max(p.full_name) AS name,
            string_agg(DISTINCT nullif(p.state, ''), ', ') AS state,
            array_agg(DISTINCT rel) FILTER (WHERE rel IS NOT NULL) AS relationships,
            array_agg(DISTINCT r.title) FILTER (WHERE r.title IS NOT NULL) AS titles,
            count(DISTINCT r.entity_id)::int AS funds,
            (SELECT json_build_object('name', trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')),
                                      'headline', c.headline, 'company', c.company, 'position', c.position,
                                      'linkedin_url', c.linkedin_url, 'photo_url', c.photo_url,
                                      'match_status', c.match_status)
             FROM user_contacts c JOIN people pp ON pp.id = c.matched_person_id
             WHERE c.workspace_id = $2 AND pp.name_normalized = p.name_normalized
               AND c.match_status IN ('auto', 'confirmed', 'possible')
             ORDER BY (c.match_status = 'possible'), c.photo_url IS NULL LIMIT 1) AS contact
     FROM roles r JOIN people p ON p.id = r.person_id LEFT JOIN LATERAL unnest(r.relationships) rel ON true
     WHERE r.entity_id = ANY($1)
     GROUP BY p.name_normalized
     ORDER BY (bool_or(rel = 'Executive Officer')) DESC NULLS LAST, count(DISTINCT r.entity_id) DESC, max(p.full_name)
     LIMIT 120`,
    [fundIds, WORKSPACE_ID])).rows;

  return { id, kind, name: e.name, cik: e.cik, city: e.city, state: e.state, jurisdiction: e.jurisdiction,
           entity_form: e.entity_form, aliases: e.aliases, fund, managers, funds, members, filings };
}

/** LinkedIn's own people search for someone you're not connected to (opens in the user's browser). */
export function linkedinSearchUrl(name: string, org: string): string {
  const firm = org.replace(/,?\s*(L\.?P\.?|LLC|L\.L\.C\.|Inc\.?|Ltd\.?)\s*$/i, "").replace(/\b(fund|[IVX]+)\b.*$/i, "").trim();
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${name} ${firm}`.trim())}`;
}
