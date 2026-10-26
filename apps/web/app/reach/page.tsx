import Link from "next/link";
import { revalidatePath } from "next/cache";
import Nav from "../nav";
import { enqueueMapping } from "@/lib/agent/run";
import { db, WORKSPACE_ID } from "@/lib/db";
import { requireSession } from "@/lib/session";

async function runNow() {
  "use server";
  await requireSession();
  await enqueueMapping("manual");
  revalidatePath("/reach");
}

interface Row {
  entity_id: number;
  name: string;
  type: string;
  state: string | null;
  vintage: number | null;
  total_offering_amount: string | null;
  total_amount_sold: string | null;
  best_score: number;
  contact_count: number;
  best_path: { nodes: { id: string; kind: string; label: string }[]; edges: { kind: string }[] };
}

interface Run { status: string; trigger: string; created_at: string; finished_at: string | null; error: string | null;
                stats: { funds_reachable: number; strong_paths: number; active_funds: number; contacts_used: number } | null }

const money = (v: string | null) => (v == null ? "—" : `$${(Number(v) / 1e6).toFixed(1)}M`);

export default async function ReachPage({ searchParams }: { searchParams: Promise<{ type?: string; strong?: string }> }) {
  await requireSession();
  const { type, strong } = await searchParams;
  const pool = db();
  await pool.query("UPDATE notifications SET read_at = now() WHERE workspace_id = $1 AND read_at IS NULL AND url = '/reach'",
                   [WORKSPACE_ID]);
  const run = (await pool.query<Run>(
    `SELECT status, trigger, created_at::text, finished_at::text, error, stats FROM mapping_runs
     WHERE workspace_id = $1 ORDER BY id DESC LIMIT 1`, [WORKSPACE_ID])).rows[0];
  const lastDone = (await pool.query<Run>(
    `SELECT status, trigger, created_at::text, finished_at::text, error, stats FROM mapping_runs
     WHERE workspace_id = $1 AND status = 'done' ORDER BY id DESC LIMIT 1`, [WORKSPACE_ID])).rows[0];
  const rows = (await pool.query<Row>(
    `SELECT r.entity_id, fp.name, fp.type, fp.state, fp.vintage, fp.total_offering_amount, fp.total_amount_sold,
            r.best_score, r.contact_count, r.best_path
     FROM fund_reach r JOIN fund_profiles fp ON fp.entity_id = r.entity_id
     WHERE r.workspace_id = $1 AND ($2::text IS NULL OR fp.type = $2) AND r.best_score >= $3
     ORDER BY r.best_score DESC, r.contact_count DESC LIMIT 200`,
    [WORKSPACE_ID, type === "fof" ? "fof" : null, strong ? 0.5 : 0])).rows;
  const busy = run && (run.status === "queued" || run.status === "running");

  return (
    <div className="shell">
      <Nav />
      <div className="hud-kicker">LP Commons // Reach</div>
      <h1>Funds you can reach</h1>
      <div className="card stack">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {busy ? (
            <span className="badge warn">Mapping in progress — you&apos;ll get a notification when it&apos;s ready</span>
          ) : run?.status === "failed" ? (
            <span className="badge warn">Last run failed: {run.error}</span>
          ) : null}
          {lastDone?.stats && (
            <span className="muted small">
              Mapped {new Date(lastDone.finished_at!).toLocaleString()}: {lastDone.stats.funds_reachable} of{" "}
              {lastDone.stats.active_funds} active funds reachable through {lastDone.stats.contacts_used} of your contacts,{" "}
              {lastDone.stats.strong_paths} strong.
            </span>
          )}
          <form action={runNow} style={{ marginLeft: "auto" }}><button className="secondary" type="submit" disabled={busy}>Re-map now</button></form>
        </div>
        <div className="small" style={{ display: "flex", gap: 12 }}>
          <Link href="/reach">All</Link>
          <Link href="/reach?strong=1">Strong paths only</Link>
          <Link href="/reach?type=fof">Funds of funds</Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="muted">
          Nothing mapped yet. <Link href="/import">Import your LinkedIn connections</Link> or{" "}
          <Link href="/settings">connect Google</Link>; mapping starts automatically.
        </p>
      ) : (
        <table style={{ marginTop: 16 }}>
          <thead><tr><th>Fund</th><th>Best path</th><th>Strength</th><th>Your people</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.entity_id}>
                <td>
                  <Link href={`/map?target=${r.entity_id}`}>{r.name}</Link>
                  {r.type === "fof" && <span className="badge">FoF</span>}
                  <div className="muted small">{[r.state, r.vintage && `vintage ${r.vintage}`, `raised ${money(r.total_amount_sold)} of ${money(r.total_offering_amount)}`].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="small">{r.best_path.nodes.slice(1, -1).map((n) => n.label).join(" → ")}</td>
                <td><span className={`badge ${r.best_score >= 0.5 ? "ok" : "warn"}`}>{Math.round(r.best_score * 100)}%</span></td>
                <td>{r.contact_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">Based on public Form D filings and your own network; matches can be wrong. Open a fund to see evidence for every hop. Not investment advice.</p>
    </div>
  );
}
