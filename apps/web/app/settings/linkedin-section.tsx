import { redirect } from "next/navigation";
import { enqueueMapping } from "@/lib/agent/run";
import { linkedinAgentEnabled, requestCrawl, startLinkedInLogin } from "@/lib/agent-link";
import { db, WORKSPACE_ID } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { Icon } from "../ui/icons";

const CONSENTS = [
  ["risk", "I understand LinkedIn's User Agreement prohibits automated access, and LinkedIn may restrict or suspend my account. I accept that risk for my own account."],
  ["scope", "The agent may read my own connections list and their Experience sections, read-only. It will never message, invite, like, post, or change anything."],
  ["session", "My LinkedIn session (cookies) will be stored encrypted on this server so the agent can work in the background. I can disconnect and delete it at any time."],
] as const;

async function connect(formData: FormData) {
  "use server";
  await requireSession();
  if (!CONSENTS.every(([k]) => formData.get(k) === "on")) redirect("/settings?error=linkedin_consent");
  let sessionId: string;
  try {
    sessionId = await startLinkedInLogin();
  } catch {
    redirect("/settings?error=linkedin_agent_down");
  }
  redirect(`/linkedin/live?s=${sessionId}`);
}

async function syncNow() {
  "use server";
  await requireSession();
  await requestCrawl();
  redirect("/settings?ok=linkedin_sync");
}

async function disconnect() {
  "use server";
  await requireSession();
  const pool = db();
  await pool.query("DELETE FROM integrations WHERE workspace_id = $1 AND provider = 'linkedin'", [WORKSPACE_ID]);
  await pool.query(
    `DELETE FROM user_contact_experience WHERE contact_id IN (SELECT id FROM user_contacts WHERE workspace_id = $1)`,
    [WORKSPACE_ID]);
  await pool.query("UPDATE user_contacts SET enriched_at = NULL WHERE workspace_id = $1", [WORKSPACE_ID]);
  await enqueueMapping("linkedin_agent");
  redirect("/settings?ok=linkedin_disconnected");
}

export default async function LinkedInSection() {
  if (!linkedinAgentEnabled()) return null;
  const pool = db();
  const integ = (await pool.query<{ status: string; status_detail: string | null; last_synced_at: string | null;
                                    last_sync_stats: { connections?: number } | null }>(
    `SELECT status, status_detail, last_synced_at::text, last_sync_stats FROM integrations
     WHERE workspace_id = $1 AND provider = 'linkedin'`, [WORKSPACE_ID])).rows[0];
  const progress = (await pool.query<{ total: string; done: string; today: string }>(
    `SELECT count(*) AS total, count(enriched_at) AS done,
            count(*) FILTER (WHERE enriched_at >= date_trunc('day', now())) AS today
     FROM user_contacts WHERE workspace_id = $1 AND source = 'linkedin'`, [WORKSPACE_ID])).rows[0];

  const pct = Number(progress.total) ? Math.round((Number(progress.done) / Number(progress.total)) * 100) : 0;
  return (
    <section className="card stack">
      <div className="card-head" style={{ margin: 0 }}>
        <div className="row">
          <span className="stat-icon blue" style={{ margin: 0 }}><Icon name="linkedin" /></span>
          <div>
            <h2>LinkedIn agent</h2>
            <p className="muted small" style={{ marginTop: 2 }}>Opt-in. Reads your connections and their work history, read-only.</p>
          </div>
        </div>
        {integ
          ? <span className={`badge ${integ.status === "connected" ? "ok" : "warn"}`}>{integ.status.replace("_", " ")}</span>
          : <span className="badge neutral">Not connected</span>}
      </div>
      <p className="muted small">
        You sign in to LinkedIn in a browser window on this server; an agent then reads your connections and their work
        history in the background, slowly (one profile every ~20–50 seconds, a capped number per day), and maps intro
        paths as it goes. If LinkedIn shows a security check, the agent stops and asks you to sign in again; it never
        tries to get around one.
      </p>
      {integ ? (
        <>
          {integ.status_detail && <p className="error small">{integ.status_detail}</p>}
          <div>
            <div className="row small" style={{ justifyContent: "space-between", marginBottom: 6 }}>
              <span className="muted">{integ.last_synced_at ? `Connections read ${new Date(integ.last_synced_at).toLocaleString()} (${integ.last_sync_stats?.connections ?? 0})` : "Reading connections…"}</span>
              <span className="strong">{progress.done} of {progress.total} profiles · {progress.today} today</span>
            </div>
            <div className="progress"><i style={{ width: `${pct}%` }} /></div>
          </div>
          <div className="row">
            {integ.status === "connected"
              ? <form action={syncNow}><button type="submit"><Icon name="refresh" size={16} />Run now</button></form>
              : <form action={connect}>{CONSENTS.map(([k]) => <input key={k} type="hidden" name={k} value="on" />)}
                  <button type="submit">Sign in again</button></form>}
            <form action={disconnect}><button className="danger" type="submit">Disconnect and delete session + work history</button></form>
          </div>
        </>
      ) : (
        <form action={connect} className="stack">
          {CONSENTS.map(([k, text]) => (
            <label key={k} className="check"><input type="checkbox" name={k} required /> <span>{text}</span></label>
          ))}
          <div><button type="submit"><Icon name="linkedin" size={16} />Open LinkedIn sign-in window</button></div>
        </form>
      )}
    </section>
  );
}
