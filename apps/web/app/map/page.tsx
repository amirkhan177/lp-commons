import Link from "next/link";
import Nav from "../nav";
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

  return (
    <div className="shell">
      <Nav />
      <div className="map-layout">
        <section className="stack">
          <h1 style={{ margin: 0 }}>Path mapper</h1>
          {contactCount === 0 && (
            <p className="notice">No network imported yet. <Link href="/import">Upload your LinkedIn connections</Link> to find intro paths.</p>
          )}
          <form method="get" action="/map">
            <input type="search" name="q" defaultValue={q} placeholder="Search a fund or fund-of-funds…" aria-label="Search funds" />
          </form>
          {hits.length > 0 && (
            <ul className="results card">
              {hits.map((h) => (
                <li key={h.entity_id}>
                  <Link href={`/map?q=${encodeURIComponent(q)}&target=${h.entity_id}`}>{h.name}</Link>
                  {h.type === "fof" && <span className="badge">FoF</span>}
                  {h.is_active && <span className="badge ok">active</span>}
                  {h.is_spv && <span className="badge warn">SPV</span>}
                  <div className="muted small">{[h.state, h.vintage && `vintage ${h.vintage}`, h.total_offering_amount && `target ${money(h.total_offering_amount)}`].filter(Boolean).join(" · ")}</div>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && hits.length === 0 && <p className="muted">No funds match “{q}”.</p>}
        </section>

        <section className="stack">
          {t ? (
            <>
              <div className="card">
                <h2 style={{ margin: 0 }}>{t.name}</h2>
                <p className="muted small" style={{ margin: "4px 0 0" }}>
                  CIK {t.cik} · {t.state ?? "—"} · vintage {t.vintage ?? "—"} · raised {money(t.total_amount_sold)} of {money(t.total_offering_amount)}
                  {t.num_investors != null && ` · ${t.num_investors} investors`}
                  {" · "}<a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${t.cik}&type=D`} target="_blank" rel="noreferrer">EDGAR filings</a>
                </p>
              </div>
              {paths.length === 0 ? (
                <p className="muted">No intro paths found from your imported network to this fund yet.</p>
              ) : (
                <PathExplorer graph={view!} paths={paths} />
              )}
              <p className="muted small">
                Paths come from public Form D filings and your own connections; names are matched automatically and can be wrong.
                Check the linked filings before reaching out. Not investment advice. <Link href="/import">Review matches</Link>.
              </p>
            </>
          ) : (
            <p className="muted">Search for a fund and pick it to see warm intro paths from your network.</p>
          )}
        </section>
      </div>
    </div>
  );
}
