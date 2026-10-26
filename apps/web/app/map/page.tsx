import Link from "next/link";
import Nav from "../nav";
import HudShell from "../hud-shell";
import PathExplorer from "./path-explorer";
import { buildTargetGraph, getTarget, searchFunds } from "@/lib/graph/build";
import { findPaths, pathSubgraph } from "@/lib/graph/paths";
import { db, WORKSPACE_ID } from "@/lib/db";
import { requireSession } from "@/lib/session";

const money = (v: string | null) =>
  v == null ? "—" : Number(v) >= 1e6 ? `$${(Number(v) / 1e6).toFixed(1)}M` : `$${Number(v).toLocaleString()}`;

export default async function MapPage({ searchParams }: { searchParams: Promise<{ q?: string; target?: string }> }) {
  await requireSession();
  const { q = "", target } = await searchParams;
  const contactCount = Number((await db().query<{ n: string }>(
    "SELECT count(*) AS n FROM user_contacts WHERE workspace_id = $1", [WORKSPACE_ID])).rows[0].n);
  const hits = q.trim().length >= 2 ? await searchFunds(q.trim()) : [];
  const t = target && /^\d+$/.test(target) ? await getTarget(Number(target)) : null;
  const graph = t ? await buildTargetGraph(t) : null;
  const paths = graph && t ? findPaths(graph, "me", `e:${t.id}`, { limit: 15 }) : [];
  const view = graph ? pathSubgraph(graph, paths) : null;
  const raised = t && t.total_offering_amount && Number(t.total_offering_amount) > 0
    ? Math.min(1, Number(t.total_amount_sold ?? 0) / Number(t.total_offering_amount)) : null;

  return (
    <HudShell>
      <div className="shell">
        <Nav />
        <div className="map-layout">
          <section className="stack">
            <div>
              <div className="hud-kicker">LP Commons // Ops console</div>
              <h1 className="hud-title" style={{ fontSize: 18, marginTop: 6 }}>Path mapper</h1>
            </div>
            {contactCount === 0 && (
              <p className="notice">No network on file. <Link href="/import">Import your connections</Link> to light up routes.</p>
            )}
            <form method="get" action="/map" className="hud-search">
              <span aria-hidden>&gt;</span>
              <input type="search" name="q" defaultValue={q} placeholder="Search a fund or fund-of-funds" aria-label="Search funds" autoComplete="off" />
            </form>
            {hits.length > 0 && (
              <div className="hud-panel">
                <div className="hud-kicker" style={{ marginBottom: 6 }}>{hits.length} candidates</div>
                <ul className="hud-results">
                  {hits.map((h) => (
                    <li key={h.entity_id}>
                      <Link href={`/map?q=${encodeURIComponent(q)}&target=${h.entity_id}`}>{h.name}</Link>
                      {h.type === "fof" && <span className="badge">FoF</span>}
                      {h.is_active && <span className="badge ok">active</span>}
                      {h.is_spv && <span className="badge warn">SPV</span>}
                      <div className="muted small">{[h.state, h.vintage && `vintage ${h.vintage}`, h.total_offering_amount && `raising ${money(h.total_offering_amount)}`].filter(Boolean).join(" · ")}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {q.trim().length >= 2 && hits.length === 0 && <p className="muted">No match for “{q}”.</p>}
            {!t && (
              <div className="boot" aria-live="polite">
                <span>&gt; System online</span>
                <span>&gt; Form D index loaded</span>
                <span>&gt; Network link: {contactCount.toLocaleString()} contacts</span>
                <span>&gt; Select a fund…</span>
              </div>
            )}
          </section>

          <section className="stack">
            {t ? (
              <>
                <div className="hud-panel target">
                  <div className="hud-kicker" style={{ color: "var(--hud-target)" }}>◉ Fund profile · CIK {t.cik}</div>
                  <div className="dossier-name">{t.name}</div>
                  <div className="dossier-grid">
                    <div className="dossier-cell"><small>Vintage</small><b>{t.vintage ?? "—"}</b></div>
                    <div className="dossier-cell"><small>Raised</small><b>{money(t.total_amount_sold)}</b></div>
                    <div className="dossier-cell"><small>Raise goal</small><b>{money(t.total_offering_amount)}</b></div>
                    <div className="dossier-cell"><small>Investors</small><b>{t.num_investors ?? "—"}</b></div>
                    <div className="dossier-cell"><small>Status</small><b style={{ color: t.is_active ? "var(--hud-green)" : "var(--hud-muted)" }}>{t.is_active ? "Raising" : "Quiet"}</b></div>
                  </div>
                  {raised != null && <div className="gauge" title={`${Math.round(raised * 100)}% of raise goal raised`}><i style={{ width: `${raised * 100}%` }} /></div>}
                  <div className="small muted" style={{ marginTop: 10 }}>
                    <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${t.cik}&type=D`} target="_blank" rel="noreferrer">Source: SEC EDGAR filings ↗</a>
                  </div>
                </div>
                {paths.length === 0 ? (
                  <div className="hud-panel"><p style={{ margin: 0 }} className="muted">No route found from your network to this fund yet.</p></div>
                ) : (
                  <PathExplorer graph={view!} paths={paths} targetId={`e:${t.id}`} />
                )}
                <p className="muted small">
                  Routes come from public Form D filings and your own connections; names are matched automatically and can be
                  wrong. Verify the linked sources before reaching out. Not investment advice. <Link href="/import">Review matches</Link>.
                </p>
              </>
            ) : (
              <div className="hud-panel" style={{ minHeight: 240, display: "grid", placeItems: "center", textAlign: "center" }}>
                <div>
                  <div className="hud-title" style={{ justifyContent: "center" }}>No fund selected</div>
                  <p className="muted small" style={{ marginTop: 10 }}>Search a fund on the left to compute warm intro routes through your network.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </HudShell>
  );
}
