import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell, { Empty, Flash, Notice, PageHead } from "../ui/shell";
import { Icon } from "../ui/icons";
import { db, WORKSPACE_ID } from "@/lib/db";
import { deleteAllContacts, setMatchDecision } from "@/lib/import";
import { uploadConnections } from "./actions";
import { requireSession } from "@/lib/session";
import { enqueueMapping } from "@/lib/agent/run";
import { ConfirmButton, SubmitButton } from "../ui/forms";

async function decide(formData: FormData) {
  "use server";
  await requireSession();
  const decision = formData.get("decision") === "confirmed" ? "confirmed" : "rejected";
  await setMatchDecision(Number(formData.get("contactId")), decision);
  await enqueueMapping("match_review");
  revalidatePath("/import");
}

async function wipe() {
  "use server";
  await requireSession();
  await deleteAllContacts();
  redirect("/import?ok=" + encodeURIComponent("Deleted all imported contacts."));
}

interface MatchRow {
  id: number;
  first_name: string;
  last_name: string;
  company: string | null;
  position: string | null;
  match_status: string;
  person_name: string;
  person_state: string;
  roles: { entity: string; relationships: string[]; url: string }[];
}

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireSession();
  const { ok, error } = await searchParams;
  const pool = db();
  const agentOn = (await pool.query<{ ok: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM integrations WHERE workspace_id = $1 AND provider = 'linkedin' AND status = 'connected') AS ok",
    [WORKSPACE_ID])).rows[0].ok;
  const stats = (await pool.query<{ total: string; matched: string; possible: string; firm: string }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE match_status IN ('auto', 'confirmed')) AS matched,
            count(*) FILTER (WHERE match_status = 'possible') AS possible,
            count(*) FILTER (WHERE company_firm_key IN (SELECT firm_key FROM entities WHERE firm_key IS NOT NULL)) AS firm
     FROM user_contacts WHERE workspace_id = $1`, [WORKSPACE_ID])).rows[0];
  const matches = (await pool.query<MatchRow>(
    `SELECT c.id, c.first_name, c.last_name, c.company, c.position, c.match_status,
            p.full_name AS person_name, p.state AS person_state,
            COALESCE((SELECT json_agg(json_build_object('entity', e.name, 'relationships', r.relationships,
                                                       'url', r.source_url) ORDER BY r.filed_at DESC)
                      FROM (SELECT DISTINCT ON (entity_id) * FROM roles WHERE person_id = p.id
                            ORDER BY entity_id, filed_at DESC) r
                      JOIN entities e ON e.id = r.entity_id), '[]') AS roles
     FROM user_contacts c JOIN people p ON p.id = c.matched_person_id
     WHERE c.workspace_id = $1 AND c.match_status <> 'rejected'
     ORDER BY (c.match_status = 'possible') DESC, c.last_name LIMIT 200`, [WORKSPACE_ID])).rows;

  const initials = (f: string, l: string) => `${f[0] ?? ""}${l[0] ?? ""}`.toUpperCase();
  return (
    <Shell>
      <PageHead title="Your network" sub="Your connections, and which of them appear on Form D filings. Everything here stays in this private instance." />
      <Flash ok={ok} error={error} />

      <div className="card tight" style={{ marginBottom: 20 }}>
        <div className="stats">
          <div className="stat active"><span className="stat-icon blue"><Icon name="users" /></span><span className="stat-label">Connections</span><span className="stat-value">{Number(stats.total).toLocaleString()}</span></div>
          <div className="stat"><span className="stat-icon green"><Icon name="check" /></span><span className="stat-label">Matched to filings</span><span className="stat-value">{Number(stats.matched).toLocaleString()}</span><span className="stat-sub">named on a Form D</span></div>
          <div className="stat"><span className="stat-icon amber"><Icon name="alert" /></span><span className="stat-label">Need review</span><span className="stat-value">{Number(stats.possible).toLocaleString()}</span><span className="stat-sub">same name, unconfirmed</span></div>
          <div className="stat"><span className="stat-icon violet"><Icon name="building" /></span><span className="stat-label">At a filing firm</span><span className="stat-value">{Number(stats.firm).toLocaleString()}</span><span className="stat-sub">work where a fund filed</span></div>
        </div>
      </div>

      <section className="card stack" style={{ marginBottom: 20 }}>
        <div className="card-head" style={{ margin: 0 }}>
          <div>
            <h2>{agentOn ? "Upload a LinkedIn export (optional)" : "Import LinkedIn connections"}</h2>
            <p>LinkedIn → Settings → Data privacy → Get a copy of your data → Connections. Never added to the public dataset.</p>
          </div>
          {!agentOn && <Link className="btn secondary sm" href="/settings">Or connect the LinkedIn agent</Link>}
        </div>
        {agentOn && <Notice kind="ok">LinkedIn agent connected. It keeps your connections in sync, so no upload is needed.</Notice>}
        <form action={uploadConnections} className="row">
          <input type="hidden" name="returnTo" value="/import" />
          <input type="file" name="file" accept=".csv,text/csv" required aria-label="Connections.csv" />
          <SubmitButton icon="upload" pending="Importing…">Import connections</SubmitButton>
        </form>
      </section>

      <section className="card flush">
        <div className="card-head" style={{ padding: "20px 24px 16px", margin: 0 }}>
          <div>
            <h2>Matches</h2>
            <p>Connections whose name matches a person on a Form D filing. Confirm or reject the possible ones.</p>
          </div>
        </div>
        {matches.length === 0 ? (
          <Empty icon="users" title="No matches yet">Matches appear after you import connections and the mapper runs.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="cards">
              <thead><tr><th>Your connection</th><th>Filing person</th><th>Roles in filings</th><th /></tr></thead>
              <tbody>
                {matches.map((m) => (
                  <tr key={m.id}>
                    <td style={{ minWidth: 220 }}>
                      <div className="person">
                        <span className="avatar">{initials(m.first_name, m.last_name)}</span>
                        <div><div className="cell-title">{m.first_name} {m.last_name}</div>
                          <div className="cell-sub">{[m.position, m.company].filter(Boolean).join(" · ")}</div></div>
                      </div>
                    </td>
                    <td data-label="Filing person" style={{ minWidth: 180 }}>
                      <div className="strong">{m.person_name}</div>
                      <div className="badges" style={{ marginTop: 4 }}>
                        <span className={`badge ${m.match_status === "possible" ? "warn" : "ok"}`}>{m.match_status === "possible" ? "Possible" : m.match_status === "confirmed" ? "Confirmed" : "Matched"}</span>
                        {m.person_state && <span className="muted xs">{m.person_state}</span>}
                      </div>
                    </td>
                    <td data-label="Roles in filings" className="small" style={{ minWidth: 220 }}>
                      {m.roles.slice(0, 3).map((r) => (
                        <div key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.entity}</a> <span className="muted">{r.relationships.join(", ")}</span></div>
                      ))}
                      {m.roles.length > 3 && <div className="muted">+{m.roles.length - 3} more</div>}
                    </td>
                    <td>
                      {m.match_status !== "confirmed" && (
                        <form action={decide} className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                          <input type="hidden" name="contactId" value={m.id} />
                          <SubmitButton name="decision" value="confirmed" className="secondary sm">Same person</SubmitButton>
                          <SubmitButton name="decision" value="rejected" className="ghost sm">Not them</SubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card section stack">
        <h2>Delete your data</h2>
        <p className="muted small">Removes every imported connection and your match decisions from this instance. This can&apos;t be undone.</p>
        <div>
          <ConfirmButton action={wipe} label="Delete all imported contacts" icon="trash" title="Delete all imported contacts?"
                         confirmLabel="Delete everything" pendingLabel="Deleting…">
            <p>This permanently deletes {Number(stats.total).toLocaleString()} imported connections and every match decision you made. It can&apos;t be undone.</p>
            <p>Connected sources (LinkedIn agent, Google) will add their contacts back on their next sync.</p>
          </ConfirmButton>
        </div>
      </section>
    </Shell>
  );
}
