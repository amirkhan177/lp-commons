import "server-only";
import { enqueueMapping } from "./agent/run";
import { db, WORKSPACE_ID } from "./db";
import { syncGoogle } from "./google/sync";
import { notify } from "./notify";
import { digestText, isDue, isStale, shouldAlert, type JobName } from "./schedule";

const LOCK_KEY = 72_610_002; // one scheduler pass at a time across processes
const JOBS: JobName[] = ["freshness_check", "weekly_remap", "weekly_google_sync", "weekly_digest"];

async function lastRun(name: string): Promise<Date | null> {
  const { rows } = await db().query<{ last_run_at: Date | null }>("SELECT last_run_at FROM scheduled_jobs WHERE name = $1", [name]);
  return rows[0]?.last_run_at ?? null;
}

async function record(name: string, result: object): Promise<void> {
  await db().query(
    `INSERT INTO scheduled_jobs (name, last_run_at, last_result) VALUES ($1, now(), $2)
     ON CONFLICT (name) DO UPDATE SET last_run_at = now(), last_result = EXCLUDED.last_result`,
    [name, JSON.stringify(result)]);
}

const run: Record<JobName, () => Promise<object>> = {
  async weekly_remap() {
    await enqueueMapping("weekly", { inRequest: false });
    return { queued: true };
  },

  async weekly_google_sync() {
    const { rows } = await db().query("SELECT 1 FROM integrations WHERE workspace_id = $1 AND provider = 'google'", [WORKSPACE_ID]);
    if (!rows.length) return { skipped: "not connected" };
    const stats = await syncGoogle();
    await enqueueMapping("google_sync", { inRequest: false });
    return stats;
  },

  async freshness_check() {
    const now = new Date();
    const { rows } = await db().query<{ latest: Date | null }>("SELECT max(filed_at)::timestamptz AS latest FROM formd_filings");
    const latest = rows[0].latest;
    const stale = isStale(latest, now);
    if (shouldAlert(stale, await lastRun("freshness_alert"), now)) {
      await notify(
        "Fund data may be out of date",
        `The newest Form D filing in the database is from ${latest ? latest.toISOString().slice(0, 10) : "never"}. `
          + "SEC publishes filings every business day, so the scraper has probably stopped. Check the edgar-scraper "
          + "service logs on Railway.",
        "/onboarding",
      );
      await record("freshness_alert", { latest });
    }
    return { latest, stale };
  },

  async weekly_digest() {
    const { rows } = await db().query<{ new_raising: string; reachable: string; strong: string; top: string[] | null }>(
      `WITH fresh AS (
         SELECT entity_id, name FROM fund_profiles
         WHERE first_filed_at >= CURRENT_DATE - 7 AND raise_status = 'raising' AND name !~* 'a series of'
       )
       SELECT (SELECT count(*) FROM fresh) AS new_raising,
              count(r.entity_id) AS reachable,
              count(*) FILTER (WHERE r.best_score >= 0.5) AS strong,
              (array_agg(f.name ORDER BY r.best_score DESC))[1:3] AS top
       FROM fresh f JOIN fund_reach r ON r.entity_id = f.entity_id AND r.workspace_id = $1`,
      [WORKSPACE_ID]);
    const r = rows[0];
    const numbers = { newRaising: Number(r.new_raising), reachable: Number(r.reachable), strong: Number(r.strong), top: r.top ?? [] };
    const { title, body } = digestText(numbers);
    await notify(title, body, "/reach?status=raising");
    return numbers;
  },
};

/** Runs every job that is due. Safe to call often; a lock keeps concurrent callers from doubling up. */
export async function runDueJobs(now = new Date()): Promise<Record<string, unknown>> {
  const client = await db().connect();
  const results: Record<string, unknown> = {};
  try {
    const { rows } = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_KEY]);
    if (!rows[0].ok) return results;
    try {
      for (const name of JOBS) {
        if (!isDue(name, await lastRun(name), now)) continue;
        try {
          results[name] = await run[name]();
          await record(name, results[name] as object);
        } catch (e) {
          console.error(`job ${name} failed`, e);
          results[name] = { error: e instanceof Error ? e.message : String(e) };
          await record(name, results[name] as object); // retry on the next due window, not every tick
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
  return results;
}

let started = false;
/** Hourly tick in the web process (started from instrumentation.ts). */
export function startScheduler(): void {
  if (started) return;
  started = true;
  const tick = () => runDueJobs().catch((e) => console.error("scheduler", e));
  setTimeout(tick, 60_000);
  setInterval(tick, 3600e3);
}
