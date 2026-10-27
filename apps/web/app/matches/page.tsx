import Link from "next/link";
import { revalidatePath } from "next/cache";
import Shell, { Empty, Flash, Notice, PageHead } from "../ui/shell";
import { Icon } from "../ui/icons";
import { RaiseBadge } from "../fund-filter-bar";
import { db, WORKSPACE_ID } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { computeFitAfterResponse, getProfile } from "@/lib/thesis/fit-run";
import { labelOf, SECTORS } from "@/lib/thesis/taxonomy";
import AutoRefresh from "../onboarding/auto-refresh";
import { SubmitButton } from "../ui/forms";

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
  const run = (await pool.query<{ status: string; stats: { fofs: number; peers: number; reranked: number; rerank_error?: string } | null; finished_at: string | null; error: string | null }>(
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

  const tab = (kk: "fof" | "peer", label: string) => (
    <Link href={q({ kind: kk, all })} aria-current={kind === kk ? "true" : undefined}>
      {label}<span className="count">{c(kk)?.strong ?? 0} strong</span>
    </Link>
  );

  return (
    <Shell>
      <AutoRefresh active={running} />
      <PageHead
        title="Funds that fit your thesis"
        sub={profile?.confirmed_at
          ? <>Ranked against <b className="strong">{profile.fund_name}</b> · {profile.sectors.map((s) => labelOf(SECTORS, s)).join(", ")} · <Link href="/profile">Edit profile</Link></>
          : "Confirm your fund profile and LP Commons ranks funds of funds and peer funds by fit."}
        actions={profile?.confirmed_at ? <form action={recompute}><SubmitButton className="secondary" icon="refresh" pending="Starting…" disabled={running}>{running ? "Scoring…" : "Re-score"}</SubmitButton></form> : undefined}
      />
      <Flash ok={ok} />
      {!profile?.confirmed_at ? (
        <div className="card">
          <Empty icon="profile" title="Describe your fund first" actions={<Link className="btn" href="/profile">Set up fund profile</Link>}>
            Matching uses the thesis, stage, sectors and size you confirm. It takes about two minutes from your website.
          </Empty>
        </div>
      ) : (
        <>
          {running && <div style={{ marginBottom: 20 }}><Notice kind="info">Scoring funds against your thesis. This page refreshes on its own.</Notice></div>}
          {run?.status === "failed" && <div style={{ marginBottom: 20 }}><Notice kind="error">Last scoring failed: {run.error}</Notice></div>}
          {run?.stats?.rerank_error && <div style={{ marginBottom: 20 }}><Notice>AI review didn&apos;t run, so these are rule-based scores. {run.stats.rerank_error}</Notice></div>}
          <div className="card flush">
            <div className="card-head" style={{ padding: "20px 24px", margin: 0, borderBottom: "1px solid var(--border)" }}>
              <div className="tabs" role="navigation" aria-label="Match type">
                {tab("fof", "Funds of funds")}
                {tab("peer", "Peer funds")}
              </div>
              <div className="row">
                {run?.stats && !running && (
                  <span className="muted small">
                    {run.stats.fofs} funds of funds and {run.stats.peers} peers scored{run.stats.reranked ? ` · AI reviewed the top ${run.stats.reranked}` : ""}
                  </span>
                )}
                <Link className="btn secondary sm" href={q({ kind, all: all ? undefined : "1" })}>{all ? `Strong only (≥ ${STRONG})` : `Show all ${c(kind)?.total ?? 0}`}</Link>
              </div>
            </div>
            <p className="muted small" style={{ padding: "12px 24px 0" }}>
              {kind === "fof" ? "Funds of funds are potential LPs in your fund." : "Peer funds are likely co-investors and intro bridges to their own LPs."}
            </p>
            {rows.length === 0 ? (
              running ? <Empty icon="refresh" title="Scoring in progress">Results appear here in a minute or two.</Empty>
                : all ? <Empty icon="search" title="No funds scored yet" />
                : <Empty icon="search" title="No strong matches here yet" actions={<Link className="btn secondary" href={q({ kind, all: "1" })}>Show all</Link>}>
                    Strong means a fit score of {STRONG} or more. Weaker matches can still be worth a look.
                  </Empty>
            ) : (
              <div className="table-wrap">
                <table className="cards">
                  <thead><tr><th>Fit</th><th>Fund</th><th>Why it fits</th><th>Your route</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.entity_id}>
                        <td data-label="Fit"><span className={`score ${r.score >= STRONG ? "" : r.score >= 50 ? "mid" : "low"}`}>{r.score}</span></td>
                        <td style={{ minWidth: 240 }}>
                          <div className="cell-title"><Link href={`/org/${r.entity_id}`}>{r.name}</Link></div>
                          <div className="cell-sub">{[r.state, r.vintage && `Vintage ${r.vintage}`, `Raised ${money(r.total_amount_sold)}`].filter(Boolean).join(" · ")}</div>
                          {r.managers?.length ? <div className="cell-sub">Managed by {r.managers.slice(0, 2).join(" · ")}</div> : null}
                          <div className="badges" style={{ marginTop: 6 }}><RaiseBadge status={r.raise_status} remaining={r.remaining_to_raise} indefinite={r.offering_indefinite} /></div>
                        </td>
                        <td data-label="Why it fits" className="why small" style={{ minWidth: 240 }}>
                          {r.llm_note && <div className="llm"><Icon name="sparkle" size={14} /> {r.llm_note}</div>}
                          <div className="reasons">{r.reasons.map((x) => <span key={x}>{x}</span>)}</div>
                        </td>
                        <td data-label="Your route">{r.route != null
                          ? <Link href={`/map?target=${r.entity_id}`} className="nowrap"><span className="score">{Math.round(r.route * 100)}%</span></Link>
                          : <span className="muted small nowrap">No route yet</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="footnote">
            Fit is estimated from public Form D data (fund and manager names, size, location, raise status) against your confirmed
            profile{run?.stats?.reranked ? ", with your AI model reviewing the top matches" : ""}. Funds of funds are the LPs in the
            data today; family offices, foundations and pensions are coming as new public sources are added. Not investment advice.
          </p>
        </>
      )}
    </Shell>
  );
}
