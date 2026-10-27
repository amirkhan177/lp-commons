import Link from "next/link";
import { notFound } from "next/navigation";
import Nav from "../../nav";
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
        {f.is_active ? <span className="badge ok">raising</span> : null}
      </div>
    </div>
  );
}

function PersonnelFile({ m, org }: { m: Member; org: string }) {
  const c = m.contact;
  const roles = m.relationships ?? [];
  const position = (m.titles ?? [])[0];
  return (
    <article className={`file${c ? " linked" : ""}`} aria-label={`${m.name}, ${roles.join(", ") || "related person"}`}>
      <span className="file-no">File {String(m.id).padStart(6, "0")}</span>
      <div className="portrait" aria-hidden>
        {c?.photo_url ? (
          <>
            <img src={c.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
            <span className="tint" />
          </>
        ) : (
          <>
            <span className="mono">{initials(m.name)}</span>
            <span className="cap">No image on file</span>
          </>
        )}
        <span className="lines" />
        <span className="ret" />
        <span className="sweep" />
      </div>
      <div>
        <div className="who">{m.name}</div>
        {position && <div className="pos">{position}</div>}
        <dl className="fields">
          <dt>Role</dt><dd>{roles.join(" · ") || "Related person"}</dd>
          <dt>Funds</dt><dd>{m.funds} {m.funds === 1 ? "fund" : "funds"} here</dd>
          {m.state && <><dt>Region</dt><dd>{region(m.state)}</dd></>}
          {c && (c.headline || c.company) && <><dt>Now</dt><dd>{c.headline ?? [c.position, c.company].filter(Boolean).join(" at ")}</dd></>}
          <dt>Network</dt>
          <dd className={c ? "ok" : undefined}>
            {c ? (c.match_status === "possible" ? "Possible match — confirm in Your network" : "Your connection") : "Not connected"}
          </dd>
        </dl>
        <div className="acts">
          {c?.linkedin_url
            ? <a href={c.linkedin_url} target="_blank" rel="noreferrer">LinkedIn profile ↗</a>
            : <a href={linkedinSearchUrl(m.name, org)} target="_blank" rel="noreferrer">Find on LinkedIn ↗</a>}
        </div>
      </div>
    </article>
  );
}

const TIERS: { title: string; test: (m: Member) => boolean }[] = [
  { title: "Leadership", test: (m) => (m.relationships ?? []).includes("Executive Officer") },
  { title: "Directors", test: (m) => (m.relationships ?? []).includes("Director") },
  { title: "Other principals", test: () => true },
];

function Personnel({ members, org }: { members: Member[]; org: string }) {
  const placed = new Set<number>();
  return (
    <>
      {TIERS.map((t) => {
        const group = members.filter((m) => !placed.has(m.id) && t.test(m));
        group.forEach((m) => placed.add(m.id));
        return group.length ? (
          <div key={t.title} className="tier">
            <div className="tier-head">{t.title} · {group.length}</div>
            <div className="files">{group.map((m) => <PersonnelFile key={m.id} m={m} org={org} />)}</div>
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

  return (
    <div className="shell">
      <Nav />
      <div className="org-head">
        <div>
          <div className="hud-kicker">LP Commons // {org.kind === "manager" ? "Management company" : org.fund?.type === "fof" ? "Fund of funds" : "Fund"}</div>
          <h1 style={{ marginBottom: 0 }}>{org.name}</h1>
          <div className="org-meta">
            {(org.city || org.state) && <span>{place(org.city, org.state)}</span>}
            {org.cik && <span>CIK <b>{org.cik}</b></span>}
            {org.entity_form && <span>{org.entity_form}{org.jurisdiction ? ` · ${org.jurisdiction}` : ""}</span>}
            {org.kind === "manager" && <span><b>{org.funds.length}</b> funds · <b>{money(String(raisedTotal))}</b> raised</span>}
            <span><b>{org.members.length}</b> people{inNetwork ? <> · <b style={{ color: "var(--hud-green)" }}>{inNetwork}</b> in your network</> : null}</span>
            {org.aliases.length > 0 && <span>Formerly {org.aliases.join(", ")}</span>}
          </div>
        </div>
        <div className="org-route">
          {fit && (
            <div style={{ marginBottom: 12 }}>
              <div className="hud-kicker">Thesis fit</div>
              <div className="big" style={{ fontSize: 22 }}>{fit.score}<span className="muted small"> / 100</span></div>
              <div className="muted small" style={{ maxWidth: 320, marginLeft: "auto" }}>{fit.llm_note ?? fit.reasons.join(" · ")}</div>
            </div>
          )}
          <div className="hud-kicker">Your best route</div>
          {best != null && bestFund ? (
            <>
              <div className="big">{pct(best)}</div>
              <Link className="hud-btn" href={`/map?target=${bestFund.id}`}>Open route</Link>
            </>
          ) : (
            <div className="muted small" style={{ marginTop: 6 }}>No route from your network yet</div>
          )}
        </div>
      </div>

      {org.kind === "fund" && org.fund && (
        <div className="hud-panel org-section">
          <div className="dossier-grid">
            <div className="dossier-cell"><small>Vintage</small><b>{org.fund.vintage ?? "—"}</b></div>
            <div className="dossier-cell"><small>Raised</small><b>{money(org.fund.total_amount_sold)}</b></div>
            <div className="dossier-cell"><small>Raise goal</small><b>{money(org.fund.total_offering_amount)}</b></div>
            <div className="dossier-cell"><small>Investors</small><b>{org.fund.num_investors ?? "—"}</b></div>
            <div className="dossier-cell"><small>Status</small><b style={{ color: org.fund.is_active ? "var(--hud-green)" : "var(--hud-muted)" }}>{org.fund.is_active ? "Raising" : "Quiet"}</b></div>
          </div>
        </div>
      )}

      <section className="org-section">
        <h2 className="hud-title">Structure</h2>
        <div className="hud-panel chart" style={{ marginTop: 10 }}>
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
                  <div className="hud-kicker" style={{ textAlign: "center", marginTop: 26 }}>Sister funds</div>
                  <div className="chart-row" style={{ marginTop: 10 }}>{org.funds.slice(0, 12).map((f) => <FundNode key={f.id} f={f} />)}</div>
                </>
              )}
              {org.managers.length === 0 && <p className="muted small" style={{ textAlign: "center" }}>No management company named on this fund&apos;s filings.</p>}
            </>
          )}
        </div>
      </section>

      <section className="org-section">
        <h2 className="hud-title">Personnel · {org.members.length}</h2>
        <p className="muted small">
          From related persons named on Form D filings. LinkedIn details appear only for people who are your own
          connections; for anyone else, use LinkedIn&apos;s own search.
        </p>
        {org.members.length ? (
          <Personnel members={org.members} org={org.name} />
        ) : (
          <p className="muted">No individuals named on these filings.</p>
        )}
      </section>

      {org.kind === "fund" && org.filings.length > 0 && (
        <section className="org-section">
          <h2 className="hud-title">Filing history</h2>
          <ul className="timeline" style={{ marginTop: 12 }}>
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

      <p className="muted small" style={{ marginTop: 26 }}>
        Based on public SEC Form D filings; self-reported and may be incomplete or out of date. Not investment advice.
      </p>
    </div>
  );
}
