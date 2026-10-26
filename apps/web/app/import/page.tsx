import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Nav from "../nav";
import { db, WORKSPACE_ID } from "@/lib/db";
import { deleteAllContacts, importContacts, runMatching, setMatchDecision } from "@/lib/import";
import { parseLinkedInConnections } from "@/lib/linkedin-csv";
import { requireSession } from "@/lib/session";
import { enqueueMapping } from "@/lib/agent/run";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

async function upload(formData: FormData) {
  "use server";
  await requireSession();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect("/import?error=" + encodeURIComponent("Choose a CSV file."));
  if (file.size > MAX_UPLOAD_BYTES) redirect("/import?error=" + encodeURIComponent("File is larger than 10 MB."));
  let message: string;
  try {
    const contacts = parseLinkedInConnections(await file.text());
    const { imported } = await importContacts(contacts);
    const { auto, possible } = await runMatching();
    message = `Imported ${imported} connections. ${auto} matched to people in filings, ${possible} possible matches to review. Mapping your network in the background — you'll get a notification when it's ready.`;
    await enqueueMapping("linkedin_import");
  } catch (e) {
    redirect("/import?error=" + encodeURIComponent(e instanceof Error ? e.message : "Import failed."));
  }
  revalidatePath("/import");
  redirect("/import?ok=" + encodeURIComponent(message));
}

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

  return (
    <div className="shell">
      <Nav />
      <h1>Your network</h1>
      <div className="card stack">
        <p style={{ margin: 0 }}>
          Upload your LinkedIn <strong>Connections.csv</strong> (LinkedIn → Settings → Data privacy → Get a copy of
          your data → Connections). It stays in this private instance and is never added to the public dataset.
        </p>
        <form action={upload} className="stack">
          <input type="file" name="file" accept=".csv,text/csv" required />
          <div><button type="submit">Import connections</button></div>
        </form>
        {ok && <p className="badge ok">{ok}</p>}
        {error && <p className="error">{error}</p>}
      </div>

      <h2>Matches</h2>
      <p className="muted small">
        {stats.total} connections · {stats.matched} matched to people named in Form D filings · {stats.possible} possible
        (same name, no company corroboration — please review) · {stats.firm} work at a firm that has filed a Form D.
      </p>
      {matches.length === 0 ? (
        <p className="muted">No matches yet.</p>
      ) : (
        <table>
          <thead><tr><th>Your connection</th><th>Filing person</th><th>Roles in filings</th><th /></tr></thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.id}>
                <td>{m.first_name} {m.last_name}<div className="muted small">{[m.position, m.company].filter(Boolean).join(" · ")}</div></td>
                <td>
                  {m.person_name} <span className="muted small">{m.person_state}</span>
                  <span className={`badge ${m.match_status === "possible" ? "warn" : "ok"}`}>{m.match_status}</span>
                </td>
                <td className="small">
                  {m.roles.slice(0, 3).map((r) => (
                    <div key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.entity}</a> <span className="muted">{r.relationships.join(", ")}</span></div>
                  ))}
                  {m.roles.length > 3 && <div className="muted">+{m.roles.length - 3} more</div>}
                </td>
                <td>
                  {m.match_status !== "confirmed" && (
                    <form action={decide} style={{ display: "flex", gap: 8 }}>
                      <input type="hidden" name="contactId" value={m.id} />
                      <button name="decision" value="confirmed" className="secondary" type="submit">Same person</button>
                      <button name="decision" value="rejected" className="secondary" type="submit">Not them</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Delete your data</h2>
      <form action={wipe} className="stack">
        <label className="small"><input type="checkbox" required /> I understand this permanently deletes my imported connections and match decisions.</label>
        <div><button className="secondary" type="submit">Delete all imported contacts</button></div>
      </form>
    </div>
  );
}
