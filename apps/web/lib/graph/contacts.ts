import type { GraphEdge, GraphNode } from "./paths";
import { WORKS_AT_WEIGHT } from "./weights";

/** Your contacts with their strongest link to you (any source). Append WHERE ... to use. */
export const CONTACT_SELECT = `
  SELECT c.id, c.source, c.first_name, c.last_name, c.company, c.position, c.company_firm_key,
         c.matched_person_id, c.match_status, c.match_confidence, c.connected_on::text,
         c.meetings, c.last_met_on::text,
         COALESCE((SELECT max(strength) FROM user_edges ue WHERE ue.contact_id = c.id), 0.6) AS strength
  FROM user_contacts c`;

export interface ContactRow {
  id: number;
  source: "linkedin" | "google";
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  position: string | null;
  company_firm_key: string | null;
  matched_person_id: number | null;
  match_status: string;
  match_confidence: number | null;
  connected_on: string | null;
  meetings: number;
  last_met_on: string | null;
  strength: number;
}

function youEvidence(c: ContactRow): string {
  if (c.source === "google") {
    return c.meetings > 0
      ? `Met ${c.meetings} time${c.meetings === 1 ? "" : "s"} (Google Calendar${c.last_met_on ? ", last " + c.last_met_on : ""})`
      : "In your Google contacts";
  }
  return `LinkedIn connection${c.connected_on ? " since " + c.connected_on : ""}`;
}

/** Node for a contact plus its edges: you -> contact, contact = filing person, contact works at fund. */
export function contactEdges(
  c: ContactRow,
  hasPerson: (personId: number) => boolean,
  fundsByFirm: Map<string, string[]>,
): { node: GraphNode; edges: GraphEdge[] } {
  const id = `c:${c.id}`;
  const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "(no name)";
  const node: GraphNode = { id, kind: "contact", label: name,
                            detail: [c.position, c.company].filter(Boolean).join(" · ") || undefined };
  const edges: GraphEdge[] = [
    { source: "me", target: id, kind: c.source, weight: Number(c.strength), evidence: youEvidence(c) },
  ];
  if (c.matched_person_id && hasPerson(c.matched_person_id)) {
    edges.push({
      source: id, target: `p:${c.matched_person_id}`, kind: "match", weight: Number(c.match_confidence ?? 0.5),
      evidence: c.match_status === "possible"
        ? "Same name as a person in the filings (unconfirmed — verify)"
        : `Matched to filings by name${c.match_status === "confirmed" ? " (you confirmed)" : " and firm"}`,
    });
  }
  for (const fund of (c.company_firm_key && fundsByFirm.get(c.company_firm_key)) || []) {
    edges.push({ source: id, target: fund, kind: "works_at", weight: WORKS_AT_WEIGHT,
                 evidence: `${c.source === "google" ? "Google contact" : "LinkedIn"}: ${c.position ?? "works"} at ${c.company}` });
  }
  return { node, edges };
}
