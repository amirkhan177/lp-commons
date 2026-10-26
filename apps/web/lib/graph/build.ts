import "server-only";
import { db, WORKSPACE_ID } from "../db";
import type { Graph, GraphEdge, GraphNode } from "./paths";
import { roleWeight, SAME_FIRM_WEIGHT } from "./weights";
import { contactEdges, type ContactRow, CONTACT_SELECT } from "./contacts";

const MAX_CO_FUNDS = 300;

export interface TargetInfo {
  id: number;
  name: string;
  firm_key: string | null;
  cik: number;
  state: string | null;
  vintage: number | null;
  is_active: boolean | null;
  total_offering_amount: string | null;
  total_amount_sold: string | null;
  num_investors: number | null;
  managers: { id: number; name: string; role: "manager" | "general_partner"; url: string | null }[];
}

const MANAGERS_JSON = `COALESCE((SELECT json_agg(json_build_object('id', m.manager_entity_id, 'name', m.manager_name, 'role', m.role, 'url', m.source_url)
                                    ORDER BY m.role DESC, m.manager_name)
                     FROM fund_manager_names m WHERE m.fund_entity_id = e.id), '[]')`;

export async function getTarget(entityId: number): Promise<TargetInfo | null> {
  const { rows } = await db().query<TargetInfo>(
    `SELECT e.id, e.name, e.firm_key, e.cik, e.state, fp.vintage, fp.is_active,
            fp.total_offering_amount, fp.total_amount_sold, fp.num_investors, ${MANAGERS_JSON} AS managers
     FROM entities e LEFT JOIN fund_profiles fp ON fp.entity_id = e.id WHERE e.id = $1`,
    [entityId],
  );
  return rows[0] ?? null;
}

/**
 * Subgraph around one target fund, enough for every path shape findPaths() considers:
 *   F  = target + sibling funds of the same firm
 *   P0 = people with roles at F;  E1 = other funds of P0 (co-funds);  P1 = people at E1 (co-GPs)
 *   contacts matched to P0/P1, or whose LinkedIn company is the firm of F/E1
 */
export async function buildTargetGraph(target: TargetInfo): Promise<Graph> {
  const pool = db();
  const node = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const add = (n: GraphNode) => { if (!node.has(n.id)) node.set(n.id, n); };
  add({ id: "me", kind: "me", label: "You" });

  const firm = target.firm_key;
  const F = (await pool.query<{ id: number; name: string; firm_key: string | null }>(
    `SELECT id, name, firm_key FROM entities WHERE id = $1 OR ($2::text IS NOT NULL AND firm_key = $2)`,
    [target.id, firm],
  )).rows;
  for (const f of F) {
    add({ id: `e:${f.id}`, kind: "entity", label: f.name });
    if (f.id !== target.id) {
      edges.push({ source: `e:${f.id}`, target: `e:${target.id}`, kind: "same_firm", weight: SAME_FIRM_WEIGHT,
                   evidence: `Same firm as ${target.name}` });
    }
  }
  const fIds = F.map((f) => f.id);

  // Roles of P0 everywhere (gives E1), then roles of everyone at E1 (gives P1).
  type RoleRow = { person_id: number; full_name: string; state: string; entity_id: number; entity_name: string;
                   firm_key: string | null; relationships: string[]; source_url: string; filed_at: string | null };
  const roleSql = `
    SELECT DISTINCT ON (r.person_id, r.entity_id)
           r.person_id, p.full_name, p.state, r.entity_id, e.name AS entity_name, e.firm_key,
           r.relationships, r.source_url, r.filed_at::text
    FROM roles r JOIN people p ON p.id = r.person_id JOIN entities e ON e.id = r.entity_id
    WHERE %WHERE%
    ORDER BY r.person_id, r.entity_id, r.filed_at DESC`;
  const p0Roles = (await pool.query<RoleRow>(
    roleSql.replace("%WHERE%", "r.person_id IN (SELECT person_id FROM roles WHERE entity_id = ANY($1))"), [fIds],
  )).rows;
  const e1Ids = [...new Set(p0Roles.map((r) => r.entity_id).filter((id) => !fIds.includes(id)))].slice(0, MAX_CO_FUNDS);
  const p1Roles = e1Ids.length
    ? (await pool.query<RoleRow>(roleSql.replace("%WHERE%", "r.entity_id = ANY($1)"), [e1Ids])).rows
    : [];

  const firmKeys = new Set<string>();
  for (const r of [...p0Roles, ...p1Roles]) {
    add({ id: `p:${r.person_id}`, kind: "person", label: r.full_name, detail: r.state || undefined });
    add({ id: `e:${r.entity_id}`, kind: "entity", label: r.entity_name });
    if (r.firm_key) firmKeys.add(r.firm_key);
    edges.push({
      source: `p:${r.person_id}`, target: `e:${r.entity_id}`, kind: "role", weight: roleWeight(r.relationships),
      evidence: `${r.full_name}: ${r.relationships.join(", ") || "related person"} of ${r.entity_name} (Form D${r.filed_at ? ", " + r.filed_at : ""})`,
      url: r.source_url,
    });
  }
  if (firm) firmKeys.add(firm);
  // Dedupe role edges (P0 and P1 queries overlap on shared funds).
  const seenEdge = new Set<string>();
  const uniq = edges.filter((e) => {
    const k = `${e.source}|${e.target}|${e.kind}`;
    if (seenEdge.has(k)) return false;
    seenEdge.add(k);
    return true;
  });

  const personIds = [...node.keys()].filter((k) => k.startsWith("p:")).map((k) => Number(k.slice(2)));
  const contacts = (await pool.query<ContactRow>(
    `${CONTACT_SELECT}
     WHERE c.workspace_id = $1 AND (
       (c.matched_person_id = ANY($2) AND c.match_status IN ('auto', 'possible', 'confirmed'))
       OR c.company_firm_key = ANY($3)
       OR EXISTS (SELECT 1 FROM user_contact_experience x WHERE x.contact_id = c.id AND x.company_firm_key = ANY($3)))`,
    [WORKSPACE_ID, personIds, [...firmKeys]],
  )).rows;

  // Funds keyed by firm, for works_at edges.
  const fundsByFirm = new Map<string, string[]>();
  for (const f of F) if (f.firm_key) fundsByFirm.set(f.firm_key, [...(fundsByFirm.get(f.firm_key) ?? []), `e:${f.id}`]);
  for (const r of [...p0Roles, ...p1Roles]) {
    if (!r.firm_key) continue;
    const list = fundsByFirm.get(r.firm_key) ?? [];
    if (!list.includes(`e:${r.entity_id}`)) fundsByFirm.set(r.firm_key, [...list, `e:${r.entity_id}`]);
  }

  for (const c of contacts) {
    const { node: n, edges: es } = contactEdges(c, (pid) => node.has(`p:${pid}`), fundsByFirm);
    add(n);
    uniq.push(...es);
  }
  return { nodes: [...node.values()], edges: uniq };
}

export interface FundHit {
  entity_id: number;
  name: string;
  type: string;
  state: string | null;
  vintage: number | null;
  is_active: boolean;
  total_offering_amount: string | null;
  is_spv: boolean;
  managers: { name: string; role: "manager" | "general_partner" }[];
  via_manager: boolean; // matched because its management company / GP matched the query
}

/** Funds whose own name, or whose management company / GP name, matches the query. */
export async function searchFunds(q: string): Promise<FundHit[]> {
  const like = q.replace(/[\\%_]/g, (m) => "\\" + m);
  const key = q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const { rows } = await db().query<FundHit>(
    `WITH by_name AS (
       SELECT id, false AS via_manager FROM entities
       WHERE type IN ('vc_fund', 'fof') AND (name ILIKE '%' || $1 || '%' OR name_normalized % $2)
       ORDER BY (name ILIKE $1 || '%') DESC, similarity(name_normalized, $2) DESC
       LIMIT 100
     ), by_manager AS (
       SELECT DISTINCT m.fund_entity_id AS id, true AS via_manager
       FROM entities mg JOIN fund_managers m ON m.manager_entity_id = mg.id
       WHERE mg.type = 'gp_firm' AND (mg.name ILIKE '%' || $1 || '%' OR mg.name_normalized % $2)
       LIMIT 100
     ), hits AS (
       SELECT id, bool_and(via_manager) AS via_manager FROM (SELECT * FROM by_name UNION ALL SELECT * FROM by_manager) u
       GROUP BY id
     )
     SELECT fp.entity_id, fp.name, fp.type, fp.state, fp.vintage, fp.is_active, fp.total_offering_amount,
            fp.name ~* '(a series of|\\mspv\\M)' AS is_spv, h.via_manager,
            COALESCE((SELECT json_agg(json_build_object('name', m.manager_name, 'role', m.role) ORDER BY m.role DESC)
                      FROM fund_manager_names m WHERE m.fund_entity_id = fp.entity_id), '[]') AS managers
     FROM fund_profiles fp JOIN hits h ON h.id = fp.entity_id
     ORDER BY (fp.name ILIKE ($1 || '%')) DESC, fp.is_active DESC, h.via_manager, similarity(lower(fp.name), $2) DESC
     LIMIT 40`,
    [like, key],
  );
  return rows;
}
