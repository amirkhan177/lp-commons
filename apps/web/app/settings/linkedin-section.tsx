import { redirect } from "next/navigation";
import { enqueueMapping } from "@/lib/agent/run";
import { linkedinAgentEnabled, requestCrawl, startLinkedInLogin } from "@/lib/agent-link";
import { db, WORKSPACE_ID } from "@/lib/db";
import { requireSession } from "@/lib/session";

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

  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>LinkedIn agent <span className="badge warn">opt-in</span></h2>
      <p className="muted" style={{ margin: 0 }}>
        You sign in to LinkedIn in a browser window on this server; an agent then reads your connections and their work
        history in the background — slowly (one profile every ~20–50 seconds, a capped number per day) — and maps intro
        paths as it goes. If LinkedIn shows a security check, the agent stops and asks you to sign in again; it never
        tries to get around one.
      </p>
      {integ ? (
        <>
          <p style={{ margin: 0 }}>
            <span className={`badge ${integ.status === "connected" ? "ok" : "warn"}`}>{integ.status.replace("_", " ")}</span>{" "}
            {integ.status_detail && <span className="error small">{integ.status_detail} </span>}
            <span className="muted small">
              {integ.last_synced_at ? `Connections read ${new Date(integ.last_synced_at).toLocaleString()} (${integ.last_sync_stats?.connections ?? 0})` : "Reading connections…"}
              {" · "}{progress.done} of {progress.total} profiles read ({progress.today} today)
            </span>
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {integ.status === "connected"
              ? <form action={syncNow}><button type="submit">Run now</button></form>
              : <form action={connect}>{CONSENTS.map(([k]) => <input key={k} type="hidden" name={k} value="on" />)}
                  <button type="submit">Sign in again</button></form>}
            <form action={disconnect}><button className="secondary" type="submit">Disconnect and delete LinkedIn session + work history</button></form>
          </div>
        </>
      ) : (
        <form action={connect} className="stack">
          {CONSENTS.map(([k, text]) => (
            <label key={k} className="small" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input type="checkbox" name={k} required style={{ marginTop: 3 }} /> <span>{text}</span>
            </label>
          ))}
          <div><button type="submit">Open LinkedIn sign-in window</button></div>
        </form>
      )}
    </section>
  );
}
