import type { GraphEdge, GraphNode } from "./paths";
import { PAST_WORK_WEIGHT, WORKS_AT_WEIGHT } from "./weights";

/** Your contacts with their strongest link to you (any source). Append WHERE ... to use. */
export const CONTACT_SELECT = `
  SELECT c.id, c.source, c.first_name, c.last_name, c.company, c.position, c.company_firm_key,
         c.matched_person_id, c.match_status, c.match_confidence, c.connected_on::text,
         c.meetings, c.last_met_on::text,
         COALESCE((SELECT max(strength) FROM user_edges ue WHERE ue.contact_id = c.id), 0.6) AS strength,
         COALESCE((SELECT json_agg(json_build_object('firm', x.company_firm_key, 'company', x.company, 'titles', x.titles,
                                                     'started', x.started, 'ended', x.ended, 'current', x.is_current)
                                   ORDER BY x.position)
                   FROM user_contact_experience x WHERE x.contact_id = c.id AND x.company_firm_key IS NOT NULL), '[]') AS experience
  FROM user_contacts c`;

/** Firm keys a contact has worked at: current company plus LinkedIn work history. */
export function contactFirmKeys(c: ContactRow): string[] {
  return [...new Set([c.company_firm_key, ...c.experience.map((x) => x.firm)].filter((k): k is string => !!k))];
}

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
  experience: { firm: string; company: string; titles: string[]; started: string | null; ended: string | null; current: boolean }[];
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
  // Best "works/worked at" link per fund: current job beats past jobs.
  const byFund = new Map<string, GraphEdge>();
  const via = (firm: string | null, weight: number, evidence: string) => {
    for (const fund of (firm && fundsByFirm.get(firm)) || []) {
      const cur = byFund.get(fund);
      if (!cur || weight > cur.weight) byFund.set(fund, { source: id, target: fund, kind: "works_at", weight, evidence });
    }
  };
  via(c.company_firm_key, WORKS_AT_WEIGHT,
      `${c.source === "google" ? "Google contact" : "LinkedIn"}: ${c.position ?? "works"} at ${c.company}`);
  for (const x of c.experience) {
    const when = [x.started, x.current ? "present" : x.ended].filter(Boolean).join("–");
    via(x.firm, x.current ? WORKS_AT_WEIGHT : PAST_WORK_WEIGHT,
        `LinkedIn work history: ${x.titles[0] ?? "worked"} at ${x.company}${when ? ` (${when})` : ""}`);
  }
  edges.push(...byFund.values());
  return { node, edges };
}
