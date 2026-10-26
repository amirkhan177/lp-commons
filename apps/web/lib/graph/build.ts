import "server-only";
import { db, WORKSPACE_ID } from "../db";
import type { Graph, GraphEdge, GraphNode } from "./paths";

// Relationship strength of a Form D role, by what the filer said the person does.
function roleWeight(relationships: string[]): number {
  return relationships.some((r) => r === "Executive Officer" || r === "Director") ? 1 : 0.8;
}

const WORKS_AT_WEIGHT = 0.7;
const SAME_FIRM_WEIGHT = 0.95;
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
}

export async function getTarget(entityId: number): Promise<TargetInfo | null> {
  const { rows } = await db().query<TargetInfo>(
    `SELECT e.id, e.name, e.firm_key, e.cik, e.state, fp.vintage, fp.is_active,
            fp.total_offering_amount, fp.total_amount_sold, fp.num_investors
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
  type ContactRow = { id: number; first_name: string; last_name: string; company: string | null; position: string | null;
                      company_firm_key: string | null; matched_person_id: number | null; match_status: string;
                      match_confidence: number | null; strength: number; connected_on: string | null };
  const contacts = (await pool.query<ContactRow>(
    `SELECT c.id, c.first_name, c.last_name, c.company, c.position, c.company_firm_key, c.matched_person_id,
            c.match_status, c.match_confidence, COALESCE(ue.strength, 0.6) AS strength, c.connected_on::text
     FROM user_contacts c
     LEFT JOIN user_edges ue ON ue.contact_id = c.id AND ue.kind = 'linkedin'
     WHERE c.workspace_id = $1 AND (
       (c.matched_person_id = ANY($2) AND c.match_status IN ('auto', 'possible', 'confirmed'))
       OR c.company_firm_key = ANY($3))`,
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
    const id = `c:${c.id}`;
    const name = `${c.first_name} ${c.last_name}`.trim();
    add({ id, kind: "contact", label: name, detail: [c.position, c.company].filter(Boolean).join(" · ") || undefined });
    uniq.push({ source: "me", target: id, kind: "linkedin", weight: Number(c.strength),
                evidence: `LinkedIn connection${c.connected_on ? " since " + c.connected_on : ""}` });
    if (c.matched_person_id && node.has(`p:${c.matched_person_id}`)) {
      const conf = Number(c.match_confidence ?? 0.5);
      uniq.push({ source: id, target: `p:${c.matched_person_id}`, kind: "match", weight: conf,
                  evidence: c.match_status === "possible"
                    ? `Same name as a person in the filings (unconfirmed — verify)`
                    : `Matched to filings by name${c.match_status === "confirmed" ? " (you confirmed)" : " and firm"}` });
    }
    for (const fund of (c.company_firm_key && fundsByFirm.get(c.company_firm_key)) || []) {
      uniq.push({ source: id, target: fund, kind: "works_at", weight: WORKS_AT_WEIGHT,
                  evidence: `LinkedIn: ${c.position ?? "works"} at ${c.company}` });
    }
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
}

export async function searchFunds(q: string): Promise<FundHit[]> {
  const like = q.replace(/[\\%_]/g, (m) => "\\" + m);
  const key = q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const { rows } = await db().query<FundHit>(
    `WITH hits AS (
       SELECT id FROM entities
       WHERE type IN ('vc_fund', 'fof') AND (name ILIKE '%' || $1 || '%' OR name_normalized % $2)
       ORDER BY (name ILIKE $1 || '%') DESC, similarity(name_normalized, $2) DESC
       LIMIT 100
     )
     SELECT entity_id, name, type, state, vintage, is_active, total_offering_amount,
            name ~* '(a series of|\\mspv\\M)' AS is_spv
     FROM fund_profiles
     WHERE entity_id IN (SELECT id FROM hits)
     ORDER BY (name ILIKE ($1 || '%')) DESC, is_active DESC, similarity(lower(name), $2) DESC
     LIMIT 25`,
    [like, key],
  );
  return rows;
}
