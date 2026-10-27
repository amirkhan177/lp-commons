import Link from "next/link";
import Shell, { Empty, Notice, PageHead } from "../ui/shell";
import { Icon } from "../ui/icons";
import PathExplorer from "./path-explorer";
import FundFilterBar, { RaiseBadge } from "../fund-filter-bar";
import { hasFilters, parseFilters } from "@/lib/fund-filters";
import { buildTargetGraph, getTarget, searchFunds } from "@/lib/graph/build";
import { findPaths, pathSubgraph } from "@/lib/graph/paths";
import { db, WORKSPACE_ID } from "@/lib/db";
import { requireSession } from "@/lib/session";

const money = (v: string | null) =>
  v == null ? "—" : Number(v) >= 1e6 ? `$${(Number(v) / 1e6).toFixed(1)}M` : `$${Number(v).toLocaleString()}`;

export default async function MapPage({ searchParams }: {
  searchParams: Promise<{ q?: string; target?: string; status?: string; remaining?: string; raised?: string }>;
}) {
  await requireSession();
  const sp = await searchParams;
  const { q = "", target } = sp;
  const filters = parseFilters(sp);
  const filtering = hasFilters(filters);
  const filterQs = new URLSearchParams(
    Object.entries({ status: sp.status, remaining: sp.remaining, raised: sp.raised }).filter((e): e is [string, string] => !!e[1] && e[1] !== "0"),
  ).toString();
  const contactCount = Number((await db().query<{ n: string }>(
    "SELECT count(*) AS n FROM user_contacts WHERE workspace_id = $1", [WORKSPACE_ID])).rows[0].n);
  const hits = q.trim().length >= 2 || filtering ? await searchFunds(q.trim().length >= 2 ? q.trim() : "", filters) : [];
  const t = target && /^\d+$/.test(target) ? await getTarget(Number(target)) : null;
  const graph = t ? await buildTargetGraph(t) : null;
  const paths = graph && t ? findPaths(graph, "me", `e:${t.id}`, { limit: 15 }) : [];
  const view = graph ? pathSubgraph(graph, paths) : null;
  const raised = t && t.total_offering_amount && Number(t.total_offering_amount) > 0
    ? Math.min(1, Number(t.total_amount_sold ?? 0) / Number(t.total_offering_amount)) : null;

  const searching = q.trim().length >= 2 || filtering;
  return (
    <Shell>
      <PageHead title="Path mapper" sub="Search any fund or management company to see the warmest intro routes through your network." />
      {contactCount === 0 && (
        <div style={{ marginBottom: 20 }}><Notice>No network on file yet. <Link href="/import">Import your connections</Link> to light up routes.</Notice></div>
      )}
      <div className="map-layout">
        <section className="card tight stack">
          <form method="get" action="/map" className="top-search" style={{ maxWidth: "none", display: "block" }} role="search">
            {filters.status && <input type="hidden" name="status" value={filters.status} />}
            {filters.minRemaining && <input type="hidden" name="remaining" value={filters.minRemaining} />}
            {filters.minRaised && <input type="hidden" name="raised" value={filters.minRaised} />}
            <Icon name="search" size={18} />
            <input type="search" name="q" defaultValue={q} placeholder="Fund or management company" aria-label="Search funds" autoComplete="off" />
          </form>
          <details open={filtering}>
            <summary className="small strong" style={{ cursor: "pointer" }}>Filters{filtering ? " · on" : ""}</summary>
            <div style={{ marginTop: 12 }}><FundFilterBar action="/map" filters={filters} keep={{ q: q || undefined }} /></div>
          </details>
          {hits.length > 0 && (
            <div>
              <div className="muted xs" style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", padding: "4px 4px 8px" }}>
                {hits.length}{hits.length === 40 ? "+" : ""} {q.trim() ? "results" : "funds"}
              </div>
              <ul className="results">
                {hits.map((h) => (
                  <li key={h.entity_id}>
                    <Link className="result" aria-current={t?.id === h.entity_id ? "true" : undefined}
                          href={`/map?q=${encodeURIComponent(q)}&target=${h.entity_id}${filterQs ? `&${filterQs}` : ""}`}>
                      <div className="r-name">{h.name}</div>
                      <div className="r-meta">{[h.state, h.vintage && `Vintage ${h.vintage}`, h.total_offering_amount && `Raising ${money(h.total_offering_amount)}`].filter(Boolean).join(" · ")}</div>
                      {h.managers.length > 0 && (
                        <div className={`r-mgr${h.via_manager ? " hit" : ""}`}>
                          Managed by {h.managers.slice(0, 2).map((m) => m.name).join(" · ")}{h.managers.length > 2 && ` +${h.managers.length - 2}`}
                        </div>
                      )}
                      <div className="badges" style={{ marginTop: 6 }}>
                        {h.type === "fof" && <span className="badge violet">Fund of funds</span>}
                        <RaiseBadge status={h.raise_status} remaining={h.remaining_to_raise} indefinite={h.offering_indefinite} />
                        {h.is_spv && <span className="badge warn">SPV</span>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {searching && hits.length === 0 && <Empty icon="search" title="No funds found">Nothing matches{q.trim() ? ` “${q}”` : ""}{filtering ? " with these filters" : ""}. Try a shorter name.</Empty>}
          {!searching && !t && <p className="muted small" style={{ padding: "0 4px 4px" }}>Type at least two letters. You have {contactCount.toLocaleString()} contacts on file.</p>}
        </section>

        <section className="stack-lg">
          {t ? (
            <>
              <div className="card">
                <div className="org-hero">
                  <div className="org-id">
                    <span className="org-mark">{t.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 1)}</span>
                    <div style={{ minWidth: 0 }}>
                      <h2 style={{ fontSize: 20 }}>{t.name}</h2>
                      <div className="org-meta">
                        <span>CIK <b>{t.cik}</b></span>
                        <span className={`badge ${t.is_active ? "ok" : "neutral"}`}>{t.is_active ? "Raising" : "Quiet"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="row">
                    <Link className="btn secondary sm" href={`/org/${t.id}`}>Profile &amp; people</Link>
                    <a className="btn ghost sm" href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${t.cik}&type=D`} target="_blank" rel="noreferrer">SEC filings <Icon name="external" size={14} /></a>
                  </div>
                </div>
                <div className="kv" style={{ marginTop: 20 }}>
                  <div><small>Vintage</small><b>{t.vintage ?? "—"}</b></div>
                  <div><small>Raised</small><b>{money(t.total_amount_sold)}</b></div>
                  <div><small>Raise goal</small><b>{money(t.total_offering_amount)}</b></div>
                  <div><small>Investors</small><b>{t.num_investors ?? "—"}</b></div>
                </div>
                {raised != null && (
                  <div style={{ marginTop: 16 }}>
                    <div className="row xs muted" style={{ justifyContent: "space-between", marginBottom: 6 }}><span>Raise progress</span><b className="strong">{Math.round(raised * 100)}%</b></div>
                    <div className="progress"><i style={{ width: `${raised * 100}%` }} /></div>
                  </div>
                )}
                {t.managers.length > 0 && (
                  <div className="org-meta" style={{ marginTop: 16 }}>
                    {t.managers.map((m) => (
                      <span key={m.name}>{m.role === "manager" ? "Management co." : "General partner"}: <Link href={`/org/${m.id}`}>{m.name}</Link></span>
                    ))}
                  </div>
                )}
              </div>
              {paths.length === 0 ? (
                <div className="card"><Empty icon="map" title="No route yet" actions={<Link className="btn secondary" href="/import">Add more of your network</Link>}>
                  None of your contacts connect to this fund&apos;s people or firms yet.
                </Empty></div>
              ) : (
                <PathExplorer graph={view!} paths={paths} targetId={`e:${t.id}`} />
              )}
              <p className="footnote" style={{ marginTop: 0 }}>
                Routes come from public Form D filings and your own connections; names are matched automatically and can be
                wrong. Verify the linked sources before reaching out. Not investment advice. <Link href="/import">Review matches</Link>.
              </p>
            </>
          ) : (
            <div className="card">
              <Empty icon="map" title="Pick a fund to map">
                Search on the left, or open one from <Link href="/reach">Reach</Link> or <Link href="/matches">Matches</Link>.
                Routes show each hop with its evidence.
              </Empty>
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}
