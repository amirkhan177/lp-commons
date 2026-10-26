import "server-only";
import type { PoolClient } from "pg";
import { WORKSPACE_ID } from "../db";
import { CONTACT_SELECT, contactEdges, type ContactRow } from "../graph/contacts";
import type { Graph, GraphEdge, GraphNode } from "../graph/paths";
import { roleWeight, SAME_FIRM_WEIGHT } from "../graph/weights";

const MAX_CO_PEOPLE = 20000;
const MAX_FIRM_GROUP = 30; // larger "firms" are usually platforms, not a real shared relationship

/**
 * Everything within reach of your network, for the mapping agent:
 * your contacts that touch the filings (matched person or firm), the funds those people/firms are
 * on, co-GPs on those funds and all of *their* funds, plus sibling funds of the same firm.
 */
export async function loadNetworkGraph(db: PoolClient): Promise<{ graph: Graph; contactsUsed: number }> {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const add = (n: GraphNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); };
  add({ id: "me", kind: "me", label: "You" });

  const contacts = (await db.query<ContactRow>(
    `${CONTACT_SELECT}
     WHERE c.workspace_id = $1 AND (
       (c.matched_person_id IS NOT NULL AND c.match_status IN ('auto', 'possible', 'confirmed'))
       OR c.company_firm_key IN (SELECT firm_key FROM entities WHERE firm_key IS NOT NULL))`,
    [WORKSPACE_ID],
  )).rows;
  const contactFirms = [...new Set(contacts.map((c) => c.company_firm_key).filter((k): k is string => !!k))];
  const matched = [...new Set(contacts.map((c) => c.matched_person_id).filter((id): id is number => id != null))];

  // E_A: funds of matched people + funds of contacts' firms. P: everyone on E_A (incl. matched people).
  const eA = (await db.query<{ id: number }>(
    `SELECT DISTINCT entity_id AS id FROM roles WHERE person_id = ANY($1)
     UNION SELECT id FROM entities WHERE firm_key = ANY($2)`, [matched, contactFirms])).rows.map((r) => r.id);
  const people = (await db.query<{ id: number }>(
    `SELECT DISTINCT person_id AS id FROM roles WHERE entity_id = ANY($1) OR person_id = ANY($2) LIMIT $3`,
    [eA, matched, MAX_CO_PEOPLE])).rows.map((r) => r.id);

  // All roles of those people (gives E_B, the funds a co-GP can introduce you to).
  const roles = (await db.query<{ person_id: number; full_name: string; state: string; entity_id: number;
                                  entity_name: string; firm_key: string | null; relationships: string[];
                                  source_url: string; filed_at: string | null }>(
    `SELECT DISTINCT ON (r.person_id, r.entity_id)
            r.person_id, p.full_name, p.state, r.entity_id, e.name AS entity_name, e.firm_key,
            r.relationships, r.source_url, r.filed_at::text
     FROM roles r JOIN people p ON p.id = r.person_id JOIN entities e ON e.id = r.entity_id
     WHERE r.person_id = ANY($1)
     ORDER BY r.person_id, r.entity_id, r.filed_at DESC`, [people])).rows;
  for (const r of roles) {
    add({ id: `p:${r.person_id}`, kind: "person", label: r.full_name, detail: r.state || undefined });
    add({ id: `e:${r.entity_id}`, kind: "entity", label: r.entity_name });
    edges.push({
      source: `p:${r.person_id}`, target: `e:${r.entity_id}`, kind: "role", weight: roleWeight(r.relationships),
      evidence: `${r.full_name}: ${r.relationships.join(", ") || "related person"} of ${r.entity_name} (Form D${r.filed_at ? ", " + r.filed_at : ""})`,
      url: r.source_url,
    });
  }

  // Sibling funds of every firm in play (also where contacts' firms point).
  const firmKeys = new Set(contactFirms);
  for (const r of roles) if (r.firm_key) firmKeys.add(r.firm_key);
  const siblings = (await db.query<{ id: number; name: string; firm_key: string }>(
    `SELECT id, name, firm_key FROM entities
     WHERE firm_key = ANY($1)
       AND firm_key IN (SELECT firm_key FROM entities WHERE firm_key = ANY($1) GROUP BY 1 HAVING count(*) <= $2)`,
    [[...firmKeys], MAX_FIRM_GROUP])).rows;
  const fundsByFirm = new Map<string, string[]>();
  for (const s of siblings) {
    add({ id: `e:${s.id}`, kind: "entity", label: s.name });
    fundsByFirm.set(s.firm_key, [...(fundsByFirm.get(s.firm_key) ?? []), `e:${s.id}`]);
  }
  for (const [firm, ids] of fundsByFirm) {
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      edges.push({ source: ids[i], target: ids[j], kind: "same_firm", weight: SAME_FIRM_WEIGHT,
                   evidence: `Same firm (“${firm}”)` });
    }
  }

  for (const c of contacts) {
    const { node, edges: es } = contactEdges(c, (pid) => nodes.has(`p:${pid}`), fundsByFirm);
    add(node);
    edges.push(...es);
  }
  return { graph: { nodes: [...nodes.values()], edges }, contactsUsed: contacts.length };
}
