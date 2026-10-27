import "server-only";
import { after } from "next/server";
import { db, WORKSPACE_ID } from "../db";
import { getLlm } from "./draft";
import { blend, scoreFit, type Candidate } from "./fit";
import { chat, parseJson } from "./openrouter";
import { labelOf, SECTORS, STAGES, type FundProfileDraft } from "./taxonomy";

const KEEP_PEERS = 300;
const RERANK = 50;

export async function getProfile(): Promise<(FundProfileDraft & { website: string | null; own_entity_id: number | null; confirmed_at: string | null; draft_source: string | null }) | null> {
  const { rows } = await db().query(
    `SELECT fund_name, website, summary, sectors, stages, geographies, fund_number, target_size::float AS target_size,
            check_min::float AS check_min, check_max::float AS check_max, lp_types, keywords, own_entity_id,
            confirmed_at::text, draft_source
     FROM fund_profile WHERE workspace_id = $1`, [WORKSPACE_ID]);
  return rows[0] ?? null;
}

async function candidates(ownId: number | null): Promise<Candidate[]> {
  const { rows } = await db().query<Candidate & { raised: string | null }>(
    `SELECT fp.entity_id AS id, fp.name, fp.type, fp.state, fp.vintage, fp.total_amount_sold AS raised, fp.raise_status,
            COALESCE((SELECT array_agg(m.manager_name) FROM fund_manager_names m WHERE m.fund_entity_id = fp.entity_id), '{}') AS managers
     FROM fund_profiles fp
     WHERE fp.name !~* 'a series of' AND fp.vintage >= 2016 AND (fp.type = 'fof' OR fp.is_active)
       AND ($1::bigint IS NULL OR (fp.entity_id <> $1 AND fp.entity_id NOT IN (
         SELECT fund_entity_id FROM fund_managers WHERE manager_entity_id IN (
           SELECT manager_entity_id FROM fund_managers WHERE fund_entity_id = $1))))`,
    [ownId]);
  return rows.map((r) => ({ ...r, raised: r.raised == null ? null : Number(r.raised) }));
}

const RERANK_SYSTEM = `You rate how well each fund fits an emerging VC manager.
For a "fof" (fund of funds): would it plausibly invest in this manager's fund (focus, stage, size, emerging-manager appetite)?
For a "peer": is it a natural co-investor or intro bridge (same sectors/stage/size)?
Judge only from the given names and facts; do not assume facts you can't see.
Answer with ONE JSON array only: [{"id": <number>, "score": <0-100>, "reason": "<= 110 characters"}]`;

/** Score every candidate, keep FoFs + top peers; with a key, re-rank the top 50 with the user's LLM. */
export async function computeFit(): Promise<{ fofs: number; peers: number; reranked: number }> {
  const pool = db();
  const profile = await getProfile();
  if (!profile?.confirmed_at) throw new Error("Confirm your fund profile first.");
  const run = (await pool.query<{ id: number }>(
    "INSERT INTO fit_runs (workspace_id, status) VALUES ($1, 'running') RETURNING id", [WORKSPACE_ID])).rows[0];
  try {
    const scored = (await candidates(profile.own_entity_id)).map((c) => ({ c, f: scoreFit(profile, c) }));
    const fofs = scored.filter((s) => s.f.kind === "fof");
    const peers = scored.filter((s) => s.f.kind === "peer" && s.f.score > 0)
      .sort((a, b) => b.f.score - a.f.score).slice(0, KEEP_PEERS);
    const keep = [...fofs, ...peers];

    let notes = new Map<number, { score: number; reason: string }>();
    const llm = await getLlm();
    if (llm) {
      const top = [...keep].sort((a, b) => b.f.score - a.f.score).slice(0, RERANK);
      const brief = {
        manager: {
          fund: profile.fund_name, fund_number: profile.fund_number, target_size_usd: profile.target_size,
          thesis: profile.summary, sectors: profile.sectors.map((s) => labelOf(SECTORS, s)),
          stages: profile.stages.map((s) => labelOf(STAGES, s)), geographies: profile.geographies, keywords: profile.keywords,
        },
        funds: top.map(({ c, f }) => ({ id: c.id, kind: f.kind, name: c.name, managed_by: c.managers.slice(0, 2),
                                        location: c.state, vintage: c.vintage, raised_usd: c.raised, status: c.raise_status })),
      };
      try {
        const answer = parseJson<{ id: number; score: number; reason: string }[]>(
          (await chat(llm.key, llm.model, RERANK_SYSTEM, JSON.stringify(brief), 3000)).text);
        const allowed = new Set(top.map((t) => t.c.id));
        notes = new Map(answer.filter((a) => allowed.has(Number(a.id)) && Number.isFinite(Number(a.score)))
          .map((a) => [Number(a.id), { score: Number(a.score), reason: String(a.reason ?? "").slice(0, 160) }]));
      } catch (e) {
        console.error("fit re-rank failed; keeping keyword scores", e); // the deterministic scores still stand
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM fund_fit WHERE workspace_id = $1", [WORKSPACE_ID]);
      for (const { c, f } of keep) {
        const n = notes.get(c.id);
        await client.query(
          `INSERT INTO fund_fit (workspace_id, entity_id, kind, score, reasons, llm_note) VALUES ($1, $2, $3, $4, $5, $6)`,
          [WORKSPACE_ID, c.id, f.kind, blend(f.score, n?.score ?? null), f.reasons, n?.reason || null]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    const stats = { fofs: fofs.length, peers: peers.length, reranked: notes.size };
    await pool.query("UPDATE fit_runs SET status = 'done', finished_at = now(), stats = $2 WHERE id = $1", [run.id, JSON.stringify(stats)]);
    return stats;
  } catch (e) {
    await pool.query("UPDATE fit_runs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1",
                     [run.id, e instanceof Error ? e.message : String(e)]);
    throw e;
  }
}

export function computeFitAfterResponse(): void {
  after(() => computeFit().catch((e) => console.error("fit run failed", e)));
}
