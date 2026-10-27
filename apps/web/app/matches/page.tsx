import Link from "next/link";
import { revalidatePath } from "next/cache";
import Nav from "../nav";
import { RaiseBadge } from "../fund-filter-bar";
import { db, WORKSPACE_ID } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { computeFitAfterResponse, getProfile } from "@/lib/thesis/fit-run";
import { labelOf, SECTORS } from "@/lib/thesis/taxonomy";
import AutoRefresh from "../onboarding/auto-refresh";

const STRONG = 70;

async function recompute() {
  "use server";
  await requireSession();
  computeFitAfterResponse();
  revalidatePath("/matches");
}

interface Row {
  entity_id: number; name: string; state: string | null; vintage: number | null; total_amount_sold: string | null;
  raise_status: string | null; remaining_to_raise: string | null; offering_indefinite: boolean | null;
  score: number; reasons: string[]; llm_note: string | null; route: number | null; managers: string[] | null;
}

const money = (v: string | null) => (v == null ? "—" : `$${(Number(v) / 1e6).toFixed(1)}M`);

export default async function MatchesPage({ searchParams }: { searchParams: Promise<{ kind?: string; all?: string; ok?: string }> }) {
  await requireSession();
  const { kind: k, all, ok } = await searchParams;
  const kind = k === "peer" ? "peer" : "fof";
  const pool = db();
  const profile = await getProfile();
  const run = (await pool.query<{ status: string; stats: { fofs: number; peers: number; reranked: number } | null; finished_at: string | null; error: string | null }>(
    `SELECT CASE WHEN status = 'running' AND created_at < now() - interval '15 minutes' THEN 'failed' ELSE status END AS status,
            stats, finished_at::text,
            CASE WHEN status = 'running' THEN 'Interrupted. Re-score to try again.' ELSE error END AS error FROM fit_runs WHERE workspace_id = $1 ORDER BY id DESC LIMIT 1`, [WORKSPACE_ID])).rows[0];
  const counts = (await pool.query<{ kind: string; strong: string; total: string }>(
    `SELECT kind, count(*) FILTER (WHERE score >= $2) AS strong, count(*) AS total FROM fund_fit WHERE workspace_id = $1 GROUP BY kind`,
    [WORKSPACE_ID, STRONG])).rows;
  const c = (kk: string) => counts.find((x) => x.kind === kk);
  const rows = (await pool.query<Row>(
    `SELECT f.entity_id, fp.name, fp.state, fp.vintage, fp.total_amount_sold, fp.raise_status, fp.remaining_to_raise,
            fp.offering_indefinite, f.score, f.reasons, f.llm_note,
            (SELECT best_score FROM fund_reach r WHERE r.workspace_id = $1 AND r.entity_id = f.entity_id) AS route,
            (SELECT array_agg(m.manager_name) FROM fund_manager_names m WHERE m.fund_entity_id = f.entity_id) AS managers
     FROM fund_fit f JOIN fund_profiles fp ON fp.entity_id = f.entity_id
     WHERE f.workspace_id = $1 AND f.kind = $2 AND f.score >= $3
     ORDER BY f.score DESC, route DESC NULLS LAST LIMIT 150`,
    [WORKSPACE_ID, kind, all ? 0 : STRONG])).rows;
  const running = run?.status === "running";
  const q = (o: Record<string, string | undefined>) => "/matches?" + new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString();

  return (
    <div className="shell">
      <Nav />
      <AutoRefresh active={running} />
      <div className="hud-kicker">LP Commons // Matches</div>
      <h1>Funds that fit your thesis</h1>
      {ok && <p className="notice" style={{ borderLeftColor: "var(--hud-green)" }}>{ok}</p>}
      {!profile?.confirmed_at ? (
        <div className="hud-panel"><p style={{ margin: 0 }}>
          Confirm your fund profile first: <Link href="/profile">Describe your fund →</Link>
        </p></div>
      ) : (
        <>
          <div className="card stack">
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span className="muted small">
                Thesis: <b style={{ color: "var(--hud-text)" }}>{profile.fund_name}</b> · {profile.sectors.map((s) => labelOf(SECTORS, s)).join(", ")}{" "}
                · <Link href="/profile">edit</Link>
              </span>
              {running ? <span className="badge warn">Scoring…</span>
                : run?.status === "failed" ? <span className="badge warn">Last scoring failed: {run.error}</span>
                : run?.stats ? <span className="muted small">Scored {run.stats.fofs} funds of funds and {run.stats.peers} peer funds{run.stats.reranked ? `; AI reviewed the top ${run.stats.reranked}` : ""}.</span> : null}
              <form action={recompute} style={{ marginLeft: "auto" }}><button className="secondary" type="submit" disabled={running}>Re-score</button></form>
            </div>
            <div className="small" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <Link href={q({ kind: "fof", all })} style={{ fontWeight: kind === "fof" ? 700 : 400 }}>Funds of funds (potential LPs) · {c("fof")?.strong ?? 0} strong</Link>
              <Link href={q({ kind: "peer", all })} style={{ fontWeight: kind === "peer" ? 700 : 400 }}>Peer funds (co-investors, intro bridges) · {c("peer")?.strong ?? 0} strong</Link>
              <Link href={q({ kind, all: all ? undefined : "1" })}>{all ? `Strong fit only (≥ ${STRONG})` : `Show all · ${c(kind)?.total ?? 0}`}</Link>
            </div>
          </div>
          {rows.length === 0 ? (
            <p className="muted">
              {running ? "Scoring in progress…" : all ? "No funds scored yet." : <>No strong matches here yet. <Link href={q({ kind, all: "1" })}>Show all</Link></>}
            </p>
          ) : (
            <table style={{ marginTop: 16 }}>
              <thead><tr><th>Fit</th><th>Fund</th><th>Why</th><th>Your route</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.entity_id}>
                    <td><span className={`badge ${r.score >= STRONG ? "ok" : "warn"}`} style={{ fontSize: 13 }}>{r.score}</span></td>
                    <td>
                      <Link href={`/org/${r.entity_id}`}>{r.name}</Link>
                      <RaiseBadge status={r.raise_status} remaining={r.remaining_to_raise} indefinite={r.offering_indefinite} />
                      <div className="muted small">{[r.state, r.vintage && `vintage ${r.vintage}`, `raised ${money(r.total_amount_sold)}`].filter(Boolean).join(" · ")}</div>
                      {r.managers?.length ? <div className="muted small">Managed by {r.managers.slice(0, 2).join(" · ")}</div> : null}
                    </td>
                    <td className="small">
                      {r.llm_note && <div style={{ color: "var(--hud-text)" }}>{r.llm_note}</div>}
                      <div className="muted">{r.reasons.join(" · ")}</div>
                    </td>
                    <td>{r.route != null
                      ? <Link href={`/map?target=${r.entity_id}`}>{Math.round(r.route * 100)}%</Link>
                      : <span className="muted small">none yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small" style={{ marginTop: 14 }}>
            Fit is estimated from public Form D data (fund and manager names, size, location, raise status) against your confirmed
            profile{run?.stats?.reranked ? ", with your AI model reviewing the top matches" : ""}. Funds of funds are the LPs in the
            data today; family offices, foundations and pensions are coming as new public sources are added. Not investment advice.
          </p>
        </>
      )}
    </div>
  );
}
