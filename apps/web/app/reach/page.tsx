import Link from "next/link";
import { revalidatePath } from "next/cache";
import Shell, { Empty, Notice, PageHead } from "../ui/shell";
import { Icon } from "../ui/icons";
import FundFilterBar, { RaiseBadge } from "../fund-filter-bar";
import { filterSql, hasFilters, parseFilters } from "@/lib/fund-filters";
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
  raise_status: string | null;
  remaining_to_raise: string | null;
  offering_indefinite: boolean | null;
  best_score: number;
  contact_count: number;
  best_path: { nodes: { id: string; kind: string; label: string }[]; edges: { kind: string }[] };
}

interface Run { status: string; trigger: string; created_at: string; finished_at: string | null; error: string | null;
                stats: { funds_reachable: number; strong_paths: number; active_funds: number; contacts_used: number } | null }

const money = (v: string | null) => (v == null ? "—" : `$${(Number(v) / 1e6).toFixed(1)}M`);

export default async function ReachPage({ searchParams }: {
  searchParams: Promise<{ type?: string; strong?: string; status?: string; remaining?: string; raised?: string }>;
}) {
  await requireSession();
  const sp = await searchParams;
  const { type, strong } = sp;
  const filters = parseFilters(sp);
  const pool = db();
  await pool.query("UPDATE notifications SET read_at = now() WHERE workspace_id = $1 AND read_at IS NULL AND url = '/reach'",
                   [WORKSPACE_ID]);
  const run = (await pool.query<Run>(
    `SELECT status, trigger, created_at::text, finished_at::text, error, stats FROM mapping_runs
     WHERE workspace_id = $1 ORDER BY id DESC LIMIT 1`, [WORKSPACE_ID])).rows[0];
  const lastDone = (await pool.query<Run>(
    `SELECT status, trigger, created_at::text, finished_at::text, error, stats FROM mapping_runs
     WHERE workspace_id = $1 AND status = 'done' ORDER BY id DESC LIMIT 1`, [WORKSPACE_ID])).rows[0];
  const params: unknown[] = [WORKSPACE_ID, type === "fof" ? "fof" : null, strong ? 0.5 : 0];
  const extraWhere = filterSql(filters, "fp", params);
  const rows = (await pool.query<Row>(
    `SELECT r.entity_id, fp.name, fp.type, fp.state, fp.vintage, fp.total_offering_amount, fp.total_amount_sold,
            fp.raise_status, fp.remaining_to_raise, fp.offering_indefinite,
            r.best_score, r.contact_count, r.best_path
     FROM fund_reach r JOIN fund_profiles fp ON fp.entity_id = r.entity_id
     WHERE r.workspace_id = $1 AND ($2::text IS NULL OR fp.type = $2) AND r.best_score >= $3${extraWhere}
     ORDER BY r.best_score DESC, r.contact_count DESC LIMIT 200`,
    params)).rows;
  const busy = run && (run.status === "queued" || run.status === "running");

  const st = lastDone?.stats;
  return (
    <Shell>
      <PageHead
        title="Funds you can reach"
        sub={lastDone?.finished_at ? `Warm intro routes from your network, last mapped ${new Date(lastDone.finished_at).toLocaleString()}.` : "Warm intro routes from your network to venture funds and funds of funds."}
        actions={<form action={runNow}><button className="secondary" type="submit" disabled={busy}><Icon name="refresh" size={16} />{busy ? "Mapping…" : "Re-map now"}</button></form>}
      />
      {busy && <div style={{ marginBottom: 20 }}><Notice kind="info">Mapping in progress. You&apos;ll get a notification when it&apos;s ready.</Notice></div>}
      {!busy && run?.status === "failed" && <div style={{ marginBottom: 20 }}><Notice kind="error">Last run failed: {run.error}</Notice></div>}

      {st && (
        <div className="card tight" style={{ marginBottom: 20 }}>
          <div className="stats">
            <div className="stat active"><span className="stat-icon blue"><Icon name="building" /></span><span className="stat-label">Funds reachable</span>
              <span className="stat-value">{st.funds_reachable.toLocaleString()}</span><span className="stat-sub">of {st.active_funds.toLocaleString()} active funds</span></div>
            <div className="stat"><span className="stat-icon green"><Icon name="check" /></span><span className="stat-label">Strong routes</span>
              <span className="stat-value">{st.strong_paths.toLocaleString()}</span><span className="stat-sub">route strength 50% or more</span></div>
            <div className="stat"><span className="stat-icon violet"><Icon name="users" /></span><span className="stat-label">Contacts used</span>
              <span className="stat-value">{st.contacts_used.toLocaleString()}</span><span className="stat-sub">people bridging to a fund</span></div>
          </div>
        </div>
      )}

      <div className="card flush">
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)" }}>
          <FundFilterBar action="/reach" filters={filters} extra={
            <>
              <label>
                <span>Type</span>
                <select name="type" defaultValue={type === "fof" ? "fof" : ""}>
                  <option value="">All funds</option>
                  <option value="fof">Funds of funds</option>
                </select>
              </label>
              <label className="check"><input type="checkbox" name="strong" value="1" defaultChecked={Boolean(strong)} /> Strong routes only</label>
            </>
          } />
        </div>
        {rows.length === 0 ? (
          hasFilters(filters) || type || strong
            ? <Empty icon="search" title="No funds match these filters" actions={<Link className="btn secondary" href="/reach">Clear filters</Link>}>Try a wider status or size range.</Empty>
            : <Empty icon="network" title="Nothing mapped yet"
                     actions={<><Link className="btn" href="/import">Connect your network</Link><Link className="btn secondary" href="/settings">Connect Google</Link></>}>
                Add your LinkedIn connections or Google contacts. Mapping starts automatically.
              </Empty>
        ) : (
          <div className="table-wrap">
            <table className="cards">
              <thead><tr><th>Fund</th><th>Best route</th><th>Strength</th><th>Your people</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.entity_id}>
                    <td style={{ minWidth: 260 }}>
                      <div className="cell-title"><Link href={`/org/${r.entity_id}`}>{r.name}</Link></div>
                      <div className="cell-sub">{[r.state, r.vintage && `Vintage ${r.vintage}`, `Raised ${money(r.total_amount_sold)} of ${money(r.total_offering_amount)}`].filter(Boolean).join(" · ")}</div>
                      <div className="badges" style={{ marginTop: 6 }}>
                        {r.type === "fof" && <span className="badge violet">Fund of funds</span>}
                        <RaiseBadge status={r.raise_status} remaining={r.remaining_to_raise} indefinite={r.offering_indefinite} />
                      </div>
                    </td>
                    <td data-label="Best route" className="small" style={{ minWidth: 220 }}>
                      {r.best_path.nodes.slice(1, -1).map((n) => n.label).join(" → ")}
                      <div><Link href={`/map?target=${r.entity_id}`} className="xs">View route →</Link></div>
                    </td>
                    <td data-label="Strength"><span className={`score ${r.best_score >= 0.5 ? "" : r.best_score >= 0.3 ? "mid" : "low"}`}>{Math.round(r.best_score * 100)}%</span></td>
                    <td data-label="Your people" className="strong">{r.contact_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && <div className="table-foot">Showing {rows.length} fund{rows.length === 1 ? "" : "s"}, strongest first.</div>}
      </div>
      <p className="footnote">Based on public Form D filings and your own network; matches can be wrong. Open a fund to see evidence for every hop. Not investment advice.</p>
    </Shell>
  );
}
