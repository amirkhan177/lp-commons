// Thesis fit, without an LLM: how well a fund-of-funds (a potential LP) or a peer fund (a potential
// co-investor / intro bridge) lines up with the GP's confirmed profile. Pure and unit-tested.

import { labelOf, SECTORS, sectorsIn, type FundProfileDraft } from "./taxonomy";

export interface Candidate {
  id: number;
  name: string;
  type: "vc_fund" | "fof";
  state: string | null;
  vintage: number | null;
  raised: number | null;
  raise_status: string | null;
  managers: string[];
}

export interface Fit { kind: "fof" | "peer"; score: number; reasons: string[] }

const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "));
const REGION_OF: Record<string, string> = { U0: "asia", K3: "asia", F4: "asia", M5: "asia", X0: "europe", L3: "mena" };
const region = (state: string | null) => (!state ? null : US_STATES.has(state) ? "us" : REGION_OF[state] ?? null);
// Funds of funds that allocate to other asset classes rarely back venture managers.
const NON_VENTURE = /\b(hedge|absolute return|credit|real estate|realty|infrastructure|buyout|macro|multi-strategy)\b/i;
const EMERGING = /\b(emerging|diverse|diversity|first[- ]time|next[- ]gen|new managers?|micro ?vc|fund i\b|seed)\b/i;
const sectorLabels = (ids: string[]) => ids.map((id) => labelOf(SECTORS, id)).join(", ");
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function scoreFit(p: FundProfileDraft, c: Candidate): Fit {
  const text = `${c.name} ${c.managers.join(" ")}`;
  const theirSectors = sectorsIn(text);
  const shared = theirSectors.filter((s) => p.sectors.includes(s));
  const geoMatch = (() => { const r = region(c.state); return r != null && p.geographies.includes(r); })();
  const reasons: string[] = [];
  let score = 0;

  if (c.type === "fof") {
    score += 30;
    if (shared.length) { score += 25; reasons.push(`Focus overlaps yours: ${sectorLabels(shared)}`); }
    else if (!theirSectors.length) { score += 12; reasons.push("Generalist fund of funds"); }
    if (EMERGING.test(text)) { score += 15; reasons.push("Backs emerging / early managers"); }
    if (c.raise_status === "fresh_capital") { score += 15; reasons.push("Recently closed: likely deploying"); }
    else if (c.raise_status === "raising") { score += 8; reasons.push("Raising now: will deploy after close"); }
    if (geoMatch) { score += 10; reasons.push("Same region"); }
    if (p.target_size && c.raised && c.raised >= p.target_size * 0.5) { score += 5; reasons.push("Large enough to anchor or write a meaningful check"); }
    if (p.lp_types.length && !p.lp_types.includes("fof")) score *= 0.6;
    if (NON_VENTURE.test(text)) { score *= 0.3; reasons.unshift("Allocates mainly outside venture"); }
    return { kind: "fof", score: clamp(score), reasons: reasons.slice(0, 3) };
  }

  if (shared.length) { score += 35; reasons.push(`Same sectors: ${sectorLabels(shared)}`); }
  const stageWords = text.match(/\b(pre-?seed|seed|growth|opportunity)\b/i)?.[1]?.toLowerCase();
  if (stageWords && p.stages.some((s) => (s === "pre_seed" && stageWords.startsWith("pre")) || (s === "seed" && stageWords === "seed") || (s === "growth" && (stageWords === "growth" || stageWords === "opportunity")))) {
    score += 10; reasons.push("Same stage");
  }
  if (p.target_size && c.raised && c.raised > 0) {
    const ratio = Math.abs(Math.log(c.raised / p.target_size));
    const sizeScore = Math.max(0, 20 - ratio * 10);
    if (sizeScore >= 10) reasons.push("Similar fund size");
    score += sizeScore;
  }
  if (geoMatch) { score += 15; reasons.push("Same region"); }
  if (c.raise_status === "raising" || c.raise_status === "fresh_capital") score += 10;
  if (c.vintage && c.vintage >= new Date().getFullYear() - 3) score += 10;
  // Without any sector overlap a "peer" is only similar in size/region: cap it.
  if (!shared.length) score = Math.min(score, 35);
  return { kind: "peer", score: clamp(score), reasons: reasons.slice(0, 3) };
}

/** Blend in an LLM judgment (0..100) when one exists. */
export function blend(base: number, llm: number | null): number {
  return llm == null || !Number.isFinite(llm) ? base : clamp(0.4 * base + 0.6 * llm);
}
