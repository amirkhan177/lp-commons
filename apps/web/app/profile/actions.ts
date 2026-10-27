"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { encrypt } from "@/lib/crypto";
import { db, WORKSPACE_ID } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { draftProfile } from "@/lib/thesis/draft";
import { pdfToText } from "@/lib/thesis/extract";
import { computeFitAfterResponse } from "@/lib/thesis/fit-run";
import { checkKey, DEFAULT_MODEL, FALLBACK_MODEL } from "@/lib/thesis/openrouter";
import { cleanDraft, geoIds, lpTypeIds, parseMoney, sectorIds, stageIds } from "@/lib/thesis/taxonomy";

const MAX_DECK_BYTES = 15 * 1024 * 1024;
const back = (q: string): never => redirect(`/profile?${q}`);
const msg = (kind: "ok" | "error", text: string): never => back(`${kind}=${encodeURIComponent(text)}`);

export async function saveKey(formData: FormData) {
  await requireSession();
  const key = String(formData.get("key") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim() || DEFAULT_MODEL;
  if (!/^[\w./:-]{3,100}$/.test(model)) msg("error", "That model ID doesn't look right.");
  const check = await checkKey(key);
  if (!check.ok) msg("error", check.error ?? "Key check failed.");
  await db().query(
    `INSERT INTO integrations (workspace_id, provider, refresh_token, scopes, account_email)
     VALUES ($1, 'openrouter', $2, $3, NULL)
     ON CONFLICT (workspace_id, provider) DO UPDATE SET refresh_token = EXCLUDED.refresh_token, scopes = EXCLUDED.scopes`,
    [WORKSPACE_ID, encrypt(key), model]);
  revalidatePath("/profile");
  msg("ok", check.limit == null
    ? "Key saved and verified. Tip: set a credit limit on this key in OpenRouter."
    : `Key saved and verified (limit $${check.limit}).`);
}

export async function setModel(formData: FormData) {
  await requireSession();
  const model = String(formData.get("model") ?? "").trim() || DEFAULT_MODEL;
  if (!/^[\w./:-]{3,100}$/.test(model)) msg("error", "That model ID doesn't look right.");
  await db().query("UPDATE integrations SET scopes = $2 WHERE workspace_id = $1 AND provider = 'openrouter'", [WORKSPACE_ID, model]);
  msg("ok", `Model set to ${model}.`);
}

export async function removeKey() {
  await requireSession();
  await db().query("DELETE FROM integrations WHERE workspace_id = $1 AND provider = 'openrouter'", [WORKSPACE_ID]);
  msg("ok", "Key removed.");
}

export async function draft(formData: FormData) {
  await requireSession();
  const website = String(formData.get("website") ?? "").trim();
  const deck = formData.get("deck");
  let deckText: string | undefined;
  if (deck instanceof File && deck.size > 0) {
    if (deck.size > MAX_DECK_BYTES) msg("error", "Deck is larger than 15 MB.");
    if (!/pdf/i.test(deck.type) && !deck.name.toLowerCase().endsWith(".pdf")) msg("error", "Upload the deck as a PDF.");
    try {
      deckText = await pdfToText(new Uint8Array(await deck.arrayBuffer()));
    } catch {
      msg("error", "Couldn't read that PDF.");
    }
  }
  let result: Awaited<ReturnType<typeof draftProfile>>;
  try {
    result = await draftProfile({ website: website || undefined, deckText });
  } catch (e) {
    msg("error", e instanceof Error ? e.message : "Couldn't draft a profile.");
  }
  const d = result!.draft;
  await db().query(
    `INSERT INTO fund_profile (workspace_id, fund_name, website, summary, sectors, stages, geographies, fund_number,
                               target_size, check_min, check_max, lp_types, keywords, draft, draft_source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
     ON CONFLICT (workspace_id) DO UPDATE SET
       fund_name = COALESCE(EXCLUDED.fund_name, fund_profile.fund_name), website = COALESCE(EXCLUDED.website, fund_profile.website),
       summary = COALESCE(EXCLUDED.summary, fund_profile.summary), sectors = EXCLUDED.sectors, stages = EXCLUDED.stages,
       geographies = EXCLUDED.geographies, fund_number = COALESCE(EXCLUDED.fund_number, fund_profile.fund_number),
       target_size = COALESCE(EXCLUDED.target_size, fund_profile.target_size),
       check_min = COALESCE(EXCLUDED.check_min, fund_profile.check_min), check_max = COALESCE(EXCLUDED.check_max, fund_profile.check_max),
       lp_types = EXCLUDED.lp_types, keywords = EXCLUDED.keywords, draft = EXCLUDED.draft, draft_source = EXCLUDED.draft_source,
       confirmed_at = NULL, updated_at = now()`,
    [WORKSPACE_ID, d.fund_name, website || null, d.summary, d.sectors, d.stages, d.geographies, d.fund_number,
     d.target_size, d.check_min, d.check_max, d.lp_types, d.keywords, JSON.stringify({ ...d, pages: result!.pages }), result!.source]);
  revalidatePath("/profile");
  const r = result!;
  if (r.llmError) msg("error", `AI draft failed, so this draft comes from keywords. ${r.llmError}`);
  msg("ok", r.source === "keywords"
    ? "Draft ready from keywords (add an OpenRouter key for a better one). Review every field, then confirm."
    : r.model === FALLBACK_MODEL
      ? `Your model wasn't available, so the free ${FALLBACK_MODEL} drafted this. Review every field, then confirm.`
      : "Draft ready. Review every field, then confirm.");
}

export async function confirm(formData: FormData) {
  await requireSession();
  const list = (name: string, allowed: string[]) => formData.getAll(name).map(String).filter((v) => allowed.includes(v));
  const text = (name: string) => String(formData.get(name) ?? "").trim();
  const money = (name: string) => (text(name) ? parseMoney(text(name)) : null);
  const clean = cleanDraft({
    fund_name: text("fund_name"), summary: text("summary"),
    sectors: list("sectors", sectorIds), stages: list("stages", stageIds), geographies: list("geographies", geoIds),
    fund_number: text("fund_number") ? Number(text("fund_number")) : null,
    target_size: money("target_size"), check_min: money("check_min"), check_max: money("check_max"),
    lp_types: list("lp_types", lpTypeIds),
    keywords: text("keywords").split(",").map((k) => k.trim()).filter(Boolean),
  });
  if (!clean.fund_name) msg("error", "Add your fund's name.");
  if (!clean.sectors.length) msg("error", "Pick at least one sector.");
  const own = text("own_entity_id");
  await db().query(
    `INSERT INTO fund_profile (workspace_id, fund_name, website, summary, sectors, stages, geographies, fund_number, target_size,
                               check_min, check_max, lp_types, keywords, own_entity_id, draft_source, confirmed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'manual', now(), now())
     ON CONFLICT (workspace_id) DO UPDATE SET fund_name = EXCLUDED.fund_name, website = EXCLUDED.website,
       summary = EXCLUDED.summary, sectors = EXCLUDED.sectors, stages = EXCLUDED.stages, geographies = EXCLUDED.geographies,
       fund_number = EXCLUDED.fund_number, target_size = EXCLUDED.target_size, check_min = EXCLUDED.check_min,
       check_max = EXCLUDED.check_max, lp_types = EXCLUDED.lp_types, keywords = EXCLUDED.keywords,
       own_entity_id = EXCLUDED.own_entity_id, confirmed_at = now(), updated_at = now()`,
    [WORKSPACE_ID, clean.fund_name, text("website") || null, clean.summary, clean.sectors, clean.stages, clean.geographies,
     clean.fund_number, clean.target_size, clean.check_min, clean.check_max, clean.lp_types, clean.keywords,
     /^\d+$/.test(own) ? Number(own) : null]);
  computeFitAfterResponse();
  revalidatePath("/profile");
  redirect("/matches?ok=" + encodeURIComponent("Profile confirmed. Scoring funds against your thesis…"));
}
