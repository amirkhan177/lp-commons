import "server-only";
import { decrypt } from "../crypto";
import { db, WORKSPACE_ID } from "../db";
import { fetchPublicPage } from "./net";
import { htmlToText, relevantLinks } from "./extract";
import { chat, DEFAULT_MODEL, parseJson } from "./openrouter";
import { cleanDraft, GEOGRAPHIES, keywordDraft, LP_TYPES, SECTORS, STAGES, type FundProfileDraft } from "./taxonomy";

const MAX_CONTEXT = 24_000;

export async function getLlm(): Promise<{ key: string; model: string } | null> {
  const row = (await db().query<{ refresh_token: string; scopes: string }>(
    "SELECT refresh_token, scopes FROM integrations WHERE workspace_id = $1 AND provider = 'openrouter'", [WORKSPACE_ID])).rows[0];
  if (!row) return null;
  try {
    return { key: decrypt(row.refresh_token), model: row.scopes || DEFAULT_MODEL };
  } catch {
    return null; // key encrypted under a rotated ENCRYPTION_KEY: treat as not configured
  }
}

/** Homepage plus up to three thesis/about/team pages, as plain text. */
export async function readWebsite(url: string): Promise<{ text: string; title: string; pages: string[] }> {
  const home = await fetchPublicPage(url);
  const first = htmlToText(home.html);
  const parts = [`# ${first.title}\n${first.description}\n${first.text}`];
  const pages = [home.url];
  for (const link of relevantLinks(home.html, home.url)) {
    try {
      const page = await fetchPublicPage(link);
      const t = htmlToText(page.html);
      parts.push(`# ${t.title}\n${t.text}`);
      pages.push(page.url);
    } catch { /* a broken subpage shouldn't fail the draft */ }
  }
  return { text: parts.join("\n\n").slice(0, MAX_CONTEXT), title: first.title, pages };
}

const SYSTEM = `You extract an emerging venture capital fund's investment profile from its website and pitch deck.
Answer with ONE JSON object only, no prose. Use only these values:
sectors: ${SECTORS.map((s) => s.id).join(", ")}
stages: ${STAGES.map((s) => s.id).join(", ")}
geographies: ${GEOGRAPHIES.map((s) => s.id).join(", ")}
lp_types (which LPs this GP should target; pick what fits a fund of this size and stage): ${LP_TYPES.map((s) => s.id).join(", ")}
Fields: fund_name (string), summary (2-3 sentences: what they invest in, at what stage, why they win),
sectors (1-5), stages (1-3), geographies (1-4), fund_number (integer, e.g. 2 for "Fund II"), target_size (USD number),
check_min and check_max (USD numbers), lp_types, keywords (up to 10 specific themes, e.g. "vertical AI", "climate fintech").
Use null for anything the material doesn't support. Never invent numbers.`;

export async function draftProfile(input: { website?: string; deckText?: string }):
  Promise<{ draft: FundProfileDraft; source: "llm" | "keywords"; pages: string[] }> {
  let site = { text: "", title: "", pages: [] as string[] };
  if (input.website) site = await readWebsite(input.website);
  const material = [site.text, input.deckText ? `# Pitch deck\n${input.deckText}` : ""].filter(Boolean).join("\n\n").slice(0, MAX_CONTEXT);
  if (!material.trim()) throw new Error("Add a website or a deck to draft from.");

  const llm = await getLlm();
  if (!llm) return { draft: keywordDraft(site.title, material), source: "keywords", pages: site.pages };
  const answer = await chat(llm.key, llm.model, SYSTEM, material, 1200);
  return { draft: cleanDraft(parseJson(answer)), source: "llm", pages: site.pages };
}
