import "server-only";
import { after } from "next/server";
import { db, WORKSPACE_ID } from "../db";
import { reachAll } from "../graph/reach";
import { notify } from "../notify";
import { loadNetworkGraph } from "./network";

export type Trigger = "linkedin_import" | "google_sync" | "match_review" | "manual" | "startup";

const LOCK_KEY = 72_610_001; // pg advisory lock: one mapping run at a time per database

/** Queue a mapping run (coalesced with one already waiting) and process the queue after the response. */
export async function enqueueMapping(trigger: Trigger): Promise<void> {
  await db().query(
    `INSERT INTO mapping_runs (workspace_id, trigger)
     SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM mapping_runs WHERE workspace_id = $1 AND status = 'queued')`,
    [WORKSPACE_ID, trigger],
  );
  after(() => processQueue());
}

/**
 * Drain queued runs. Safe to call from several places at once: a session-level advisory lock lets
 * one caller work while the others return immediately. Only the lock holder runs jobs, so any run
 * still marked 'running' when we get the lock was left by a process that died.
 */
export async function processQueue(): Promise<void> {
  const client = await db().connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_KEY]);
    if (!rows[0].ok) return;
    try {
      await client.query(
        `UPDATE mapping_runs SET status = 'failed', finished_at = now(), error = 'interrupted (server restarted)'
         WHERE status = 'running'`);
      for (;;) {
        const run = (await client.query<{ id: number }>(
          `UPDATE mapping_runs SET status = 'running', started_at = now()
           WHERE id = (SELECT id FROM mapping_runs WHERE workspace_id = $1 AND status = 'queued' ORDER BY id LIMIT 1)
           RETURNING id`, [WORKSPACE_ID])).rows[0];
        if (!run) break;
        try {
          const stats = await mapNetwork(run.id);
          await client.query(
            "UPDATE mapping_runs SET status = 'done', finished_at = now(), stats = $2 WHERE id = $1",
            [run.id, JSON.stringify(stats)]);
          await notify(
            "Your intro map is ready",
            stats.funds_reachable
              ? `${stats.funds_reachable} active funds are reachable through your network, ${stats.strong_paths} with a strong path.`
              : "No active funds are reachable yet. Import more of your network or review possible matches.",
            "/reach",
          );
        } catch (e) {
          console.error("mapping run failed", e);
          await client.query(
            "UPDATE mapping_runs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1",
            [run.id, e instanceof Error ? e.message : String(e)]);
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export interface MappingStats {
  contacts_used: number;
  nodes: number;
  edges: number;
  active_funds: number;
  funds_reachable: number;
  strong_paths: number;
  ms: number;
}

const STRONG = 0.5;

/** One mapping pass: reach from your network to every active, non-SPV fund; replaces fund_reach. */
export async function mapNetwork(runId: number): Promise<MappingStats> {
  const t0 = Date.now();
  const client = await db().connect();
  try {
    const { graph, contactsUsed } = await loadNetworkGraph(client);
    const targets = (await client.query<{ entity_id: number }>(
      "SELECT entity_id FROM active_funds WHERE name !~* 'a series of'")).rows;
    const targetIds = new Set(targets.map((t) => `e:${t.entity_id}`));
    const reach = reachAll(graph, targetIds);
    const label = new Map(graph.nodes.map((n) => [n.id, n]));

    await client.query("BEGIN");
    await client.query("DELETE FROM fund_reach WHERE workspace_id = $1", [WORKSPACE_ID]);
    let strong = 0;
    for (const [id, r] of reach) {
      if (r.best.score >= STRONG) strong++;
      const path = {
        nodes: r.best.nodes.map((n) => ({ id: n, kind: label.get(n)?.kind, label: label.get(n)?.label })),
        edges: r.best.edges.map((e) => ({ kind: e.kind, evidence: e.evidence, url: e.url })),
      };
      await client.query(
        `INSERT INTO fund_reach (workspace_id, entity_id, run_id, best_score, contact_count, best_path)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [WORKSPACE_ID, Number(id.slice(2)), runId, r.best.score, r.contacts.size, JSON.stringify(path)]);
    }
    await client.query("COMMIT");
    return { contacts_used: contactsUsed, nodes: graph.nodes.length, edges: graph.edges.length,
             active_funds: targetIds.size, funds_reachable: reach.size, strong_paths: strong, ms: Date.now() - t0 };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
