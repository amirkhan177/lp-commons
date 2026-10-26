import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Nav from "../nav";
import { enqueueMapping } from "@/lib/agent/run";
import { decrypt, encryptionConfigured } from "@/lib/crypto";
import { db, WORKSPACE_ID } from "@/lib/db";
import { googleConfigured, redirectUri, revoke } from "@/lib/google/oauth";
import { syncGoogle } from "@/lib/google/sync";
import { requireSession } from "@/lib/session";

const MESSAGES: Record<string, string> = {
  google_connected: "Google connected. Syncing contacts and calendar in the background — you'll be notified when your map is updated.",
  google_synced: "Sync started.",
  google_disconnected: "Google disconnected and its contacts deleted.",
  google_not_configured: "Google isn't configured on this server yet (see below).",
  google_state: "Sign-in check failed (expired or tampered). Please try again.",
  google_denied: "Google access wasn't granted.",
  google_token: "Couldn't complete Google sign-in. Please try again.",
  google_scopes: "All three read-only permissions are needed (contacts, other contacts, calendar). Please try again and allow them.",
};

async function syncNow() {
  "use server";
  await requireSession();
  after(async () => {
    try {
      await syncGoogle();
      await enqueueMapping("google_sync");
    } catch (e) {
      console.error("google sync failed", e);
    }
  });
  redirect("/settings?ok=google_synced");
}

async function disconnect() {
  "use server";
  await requireSession();
  const pool = db();
  const row = (await pool.query<{ refresh_token: string }>(
    "SELECT refresh_token FROM integrations WHERE workspace_id = $1 AND provider = 'google'", [WORKSPACE_ID])).rows[0];
  if (row) {
    try { await revoke(decrypt(row.refresh_token)); } catch { /* still delete locally */ }
  }
  await pool.query("DELETE FROM integrations WHERE workspace_id = $1 AND provider = 'google'", [WORKSPACE_ID]);
  await pool.query("DELETE FROM user_contacts WHERE workspace_id = $1 AND source = 'google'", [WORKSPACE_ID]);
  await enqueueMapping("google_sync");
  revalidatePath("/settings");
  redirect("/settings?ok=google_disconnected");
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireSession();
  const { ok, error } = await searchParams;
  const integ = (await db().query<{ last_synced_at: string | null; last_sync_stats: { contacts: number; met: number } | null }>(
    "SELECT last_synced_at::text, last_sync_stats FROM integrations WHERE workspace_id = $1 AND provider = 'google'",
    [WORKSPACE_ID])).rows[0];
  const ready = googleConfigured() && encryptionConfigured();

  return (
    <div className="shell">
      <Nav />
      <h1>Settings</h1>
      {ok && <p className="badge ok">{MESSAGES[ok] ?? ok}</p>}
      {error && <p className="error">{MESSAGES[error] ?? error}</p>}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Google contacts & calendar</h2>
        <p className="muted" style={{ margin: 0 }}>
          Read-only access to your contacts, people you&apos;ve emailed, and who you&apos;ve met in the last two years.
          People you&apos;ve actually met count as stronger intro paths. Data stays in this private instance; the
          refresh token is encrypted at rest. Event titles and contents are never fetched.
        </p>
        {integ ? (
          <>
            <p style={{ margin: 0 }}>
              <span className="badge ok">connected</span>{" "}
              {integ.last_synced_at
                ? `Last synced ${new Date(integ.last_synced_at).toLocaleString()} · ${integ.last_sync_stats?.contacts ?? 0} contacts, ${integ.last_sync_stats?.met ?? 0} you've met`
                : "First sync in progress…"}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <form action={syncNow}><button type="submit">Sync now</button></form>
              <form action={disconnect}><button className="secondary" type="submit">Disconnect and delete Google data</button></form>
            </div>
          </>
        ) : ready ? (
          <div><a className="btn" href="/api/google/start">Connect Google</a></div>
        ) : (
          <div className="notice">
            Not configured. Create an OAuth client (type <em>Web application</em>) in Google Cloud Console, enable the
            People API and Google Calendar API, add the redirect URI <code>{process.env.APP_URL ? redirectUri() : "<APP_URL>/api/google/callback"}</code>,
            then set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, <code>APP_URL</code> and{" "}
            <code>ENCRYPTION_KEY</code> (64 hex chars) on the server.
          </div>
        )}
      </section>
    </div>
  );
}
