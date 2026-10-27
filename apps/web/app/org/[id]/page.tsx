import Link from "next/link";
import { notFound } from "next/navigation";
import Shell, { Empty } from "../../ui/shell";
import { Icon } from "../../ui/icons";
import { getOrg, linkedinSearchUrl, type Member, type OrgFund } from "@/lib/org";
import { requireSession } from "@/lib/session";
import { db, WORKSPACE_ID } from "@/lib/db";

const money = (v: string | null) =>
  v == null ? "—" : Number(v) >= 1e6 ? `$${(Number(v) / 1e6).toFixed(1)}M` : `$${Number(v).toLocaleString()}`;
const pct = (v: number | null) => (v == null ? null : `${Math.round(v * 100)}%`);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
// SEC EDGAR codes for non-US locations (US states use their usual abbreviations).
const EDGAR_REGION: Record<string, string> = {
  U0: "Singapore", K3: "Hong Kong", X0: "United Kingdom", E9: "Cayman Islands", F4: "China", L3: "Israel", M5: "South Korea",
};
const region = (codes: string) => codes.split(", ").map((c) => EDGAR_REGION[c] ?? c).join(", ");

/** "Cambridge, MA"; "Singapore" rather than "Singapore, U0". */
function place(city: string | null, state: string | null): string {
  const country = state ? EDGAR_REGION[state] : undefined;
  if (country) return city && city.toLowerCase() !== country.toLowerCase() ? `${city}, ${country}` : city ?? country;
  return [city, state].filter(Boolean).join(", ");
}

const ROLE_LABEL: Record<string, string> = { manager: "Management company", general_partner: "General partner" };

function FundNode({ f, self = false }: { f: OrgFund; self?: boolean }) {
  return (
    <div className={`org-node${self ? " self" : ""}`}>
      {f.reach != null && <span className="reach" title="Your best intro route">{pct(f.reach)}</span>}
      <span className="k">{f.type === "fof" ? "Fund of funds" : "Fund"}{f.vintage ? ` · ${f.vintage}` : ""}</span>
      {self ? <b>{f.name}</b> : <Link href={`/org/${f.id}`}>{f.name}</Link>}
      <div className="sub">
        {money(f.total_amount_sold)} of {money(f.total_offering_amount)}
        {f.is_active ? <> · <span className="badge ok">Raising</span></> : null}
      </div>
    </div>
  );
}

function PersonCard({ m, org }: { m: Member; org: string }) {
  const c = m.contact;
  const roles = m.relationships ?? [];
  const position = (m.titles ?? [])[0];
  return (
    <article className={`pcard${c ? " linked" : ""}`} aria-label={`${m.name}, ${roles.join(", ") || "related person"}`}>
      <div className="person">
        <span className={`avatar lg${c ? " ok" : ""}`}>
          {c?.photo_url ? <img src={c.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : initials(m.name)}
        </span>
        <div>
          <div className="who">{m.name}</div>
          <div className="pos">{position ?? (roles.join(" · ") || "Related person")}</div>
        </div>
      </div>
      <div className="badges">
        {c
          ? <span className={`badge ${c.match_status === "possible" ? "warn" : "ok"}`}>{c.match_status === "possible" ? "Possible connection" : "Your connection"}</span>
          : <span className="badge neutral">Not connected</span>}
        {roles.map((r) => <span key={r} className="badge">{r}</span>)}
      </div>
      <dl>
        <dt>Funds</dt><dd>{m.funds} {m.funds === 1 ? "fund" : "funds"} here</dd>
        {m.state && <><dt>Region</dt><dd>{region(m.state)}</dd></>}
        {c && (c.headline || c.company) && <><dt>Now</dt><dd>{c.headline ?? [c.position, c.company].filter(Boolean).join(" at ")}</dd></>}
      </dl>
      <div className="acts">
        {c?.linkedin_url
          ? <a href={c.linkedin_url} target="_blank" rel="noreferrer">LinkedIn profile <Icon name="external" size={13} /></a>
          : <a href={linkedinSearchUrl(m.name, org)} target="_blank" rel="noreferrer">Find on LinkedIn <Icon name="external" size={13} /></a>}
        {c?.match_status === "possible" && <Link href="/import">Confirm match</Link>}
      </div>
    </article>
  );
}

const TIERS: { title: string; test: (m: Member) => boolean }[] = [
  { title: "Leadership", test: (m) => (m.relationships ?? []).includes("Executive Officer") },
  { title: "Directors", test: (m) => (m.relationships ?? []).includes("Director") },
  { title: "Other principals", test: () => true },
];

function People({ members, org }: { members: Member[]; org: string }) {
  const placed = new Set<number>();
  return (
    <>
      {TIERS.map((t) => {
        const group = members.filter((m) => !placed.has(m.id) && t.test(m));
        group.forEach((m) => placed.add(m.id));
        return group.length ? (
          <div key={t.title} className="tier">
            <div className="tier-head">{t.title} <span className="badge neutral">{group.length}</span></div>
            <div className="people">{group.map((m) => <PersonCard key={m.id} m={m} org={org} />)}</div>
          </div>
        ) : null;
      })}
    </>
  );
}

export default async function OrgPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const org = await getOrg(Number(id));
  if (!org) notFound();

  const best = org.kind === "fund"
    ? org.fund?.reach ?? null
    : org.funds.reduce<number | null>((b, f) => (f.reach != null && (b == null || f.reach > b) ? f.reach : b), null);
  const bestFund = org.kind === "fund" ? org.fund : org.funds.filter((f) => f.reach != null).sort((a, b) => b.reach! - a.reach!)[0];
  const raisedTotal = org.funds.reduce((s, f) => s + Number(f.total_amount_sold ?? 0), 0);
  const inNetwork = org.members.filter((m) => m.contact).length;
  const fit = (await db().query<{ score: number; reasons: string[]; llm_note: string | null; kind: string }>(
    "SELECT score, reasons, llm_note, kind FROM fund_fit WHERE workspace_id = $1 AND entity_id = $2", [WORKSPACE_ID, org.id])).rows[0];
  const kindLabel = org.kind === "manager" ? "Management company" : org.fund?.type === "fof" ? "Fund of funds" : "Fund";

  return (
    <Shell>
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/reach">Reach</Link> / <span>{kindLabel}</span></nav>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="org-hero">
          <div style={{ minWidth: 0, flex: "1 1 360px" }}>
            <div className="org-id">
              <span className="org-mark">{initials(org.name.replace(/[^A-Za-z ]/g, "")) || "#"}</span>
              <div style={{ minWidth: 0 }}>
                <span className="badge violet">{kindLabel}</span>
                <h1 style={{ marginTop: 6 }}>{org.name}</h1>
              </div>
            </div>
            <div className="org-meta" style={{ marginTop: 12 }}>
              {(org.city || org.state) && <span>{place(org.city, org.state)}</span>}
              {org.cik && <span>CIK <b>{org.cik}</b></span>}
              {org.entity_form && <span>{org.entity_form}{org.jurisdiction ? ` · ${org.jurisdiction}` : ""}</span>}
              {org.aliases.length > 0 && <span>Formerly {org.aliases.join(", ")}</span>}
            </div>
            {org.kind === "fund" && org.fund && (
              <div className="kv" style={{ marginTop: 20 }}>
                <div><small>Vintage</small><b>{org.fund.vintage ?? "—"}</b></div>
                <div><small>Raised</small><b>{money(org.fund.total_amount_sold)}</b></div>
                <div><small>Raise goal</small><b>{money(org.fund.total_offering_amount)}</b></div>
                <div><small>Investors</small><b>{org.fund.num_investors ?? "—"}</b></div>
                <div><small>Status</small><b style={{ color: org.fund.is_active ? "var(--ok)" : "var(--muted)" }}>{org.fund.is_active ? "Raising" : "Quiet"}</b></div>
              </div>
            )}
            {org.kind === "manager" && (
              <div className="kv" style={{ marginTop: 20 }}>
                <div><small>Funds</small><b>{org.funds.length}</b></div>
                <div><small>Raised across funds</small><b>{money(String(raisedTotal))}</b></div>
                <div><small>People</small><b>{org.members.length}</b></div>
                <div><small>In your network</small><b style={{ color: inNetwork ? "var(--ok)" : undefined }}>{inNetwork}</b></div>
              </div>
            )}
          </div>
          <div className="org-side">
            <div className="metric">
              <small>Your best route</small>
              {best != null && bestFund ? (
                <>
                  <div className="big">{pct(best)}</div>
                  <Link className="btn" href={`/map?target=${bestFund.id}`} style={{ marginTop: 8, width: "100%" }}>Open route <Icon name="arrow" size={16} /></Link>
                </>
              ) : <div className="note">No route from your network yet</div>}
            </div>
            {fit && (
              <div className="metric">
                <small>Thesis fit</small>
                <div className="big">{fit.score}<span className="muted" style={{ fontSize: 14, fontWeight: 600 }}> / 100</span></div>
                <div className="note">{fit.llm_note ?? fit.reasons.join(" · ")}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="card">
        <div className="card-head"><div><h2>Structure</h2><p>Management company, this fund and its sister funds, from Form D filings.</p></div></div>
        <div className="chart">
          {org.kind === "manager" ? (
            <>
              <div className="chart-row">
                <div className="org-node manager self"><span className="k">Management company</span><b>{org.name}</b></div>
              </div>
              {org.funds.length > 0 && (
                <div className="chart-row kids">{org.funds.map((f) => <FundNode key={f.id} f={f} />)}</div>
              )}
            </>
          ) : (
            <>
              {org.managers.length > 0 && (
                <div className="chart-row">
                  {org.managers.map((m) => (
                    <div key={m.id} className="org-node manager">
                      <span className="k">{ROLE_LABEL[m.role]}</span>
                      <Link href={`/org/${m.id}`}>{m.name}</Link>
                    </div>
                  ))}
                </div>
              )}
              {org.fund && <div className="chart-row"><FundNode f={org.fund} self /></div>}
              {org.funds.length > 0 && (
                <>
                  <div className="chart-label">Sister funds</div>
                  <div className="chart-row" style={{ marginTop: 12 }}>{org.funds.slice(0, 12).map((f) => <FundNode key={f.id} f={f} />)}</div>
                </>
              )}
              {org.managers.length === 0 && <p className="muted small" style={{ textAlign: "center", marginTop: 12 }}>No management company named on this fund&apos;s filings.</p>}
            </>
          )}
        </div>
      </section>

      <section className="card section">
        <div className="card-head">
          <div>
            <h2>People <span className="badge neutral">{org.members.length}</span></h2>
            <p>Related persons named on Form D filings. LinkedIn details appear only for your own connections; for anyone else, use LinkedIn&apos;s search.</p>
          </div>
          {inNetwork > 0 && <span className="badge ok">{inNetwork} in your network</span>}
        </div>
        {org.members.length ? <People members={org.members} org={org.name} /> : <Empty icon="users" title="No people on these filings" />}
      </section>

      {org.kind === "fund" && org.filings.length > 0 && (
        <section className="card section">
          <div className="card-head"><div><h2>Filing history</h2><p>Every Form D notice and amendment, newest first.</p></div></div>
          <ul className="timeline">
            {org.filings.map((f, i) => (
              <li key={f.accession_number} className={i === 0 ? "first" : ""}>
                <div className="when">{f.filed_at ?? "—"} · {f.submission_type === "D/A" ? "Amendment" : "Notice"}</div>
                <a href={f.source_url} target="_blank" rel="noreferrer">
                  Sold {money(f.total_amount_sold)} of {f.offering_indefinite ? "an open-ended offering" : money(f.total_offering_amount)}
                  {f.num_investors != null ? ` · ${f.num_investors} investors` : ""}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="footnote">Based on public SEC Form D filings; self-reported and may be incomplete or out of date. Not investment advice.</p>
    </Shell>
  );
}
