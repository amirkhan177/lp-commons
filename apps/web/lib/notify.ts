import "server-only";
import { db, WORKSPACE_ID } from "./db";

/**
 * In-app notification, plus an email when RESEND_API_KEY, NOTIFY_EMAIL_FROM and NOTIFY_EMAIL_TO
 * are configured. Email failures are logged, never thrown: the in-app notice is the source of truth.
 */
export async function notify(title: string, body: string, path: string): Promise<void> {
  await db().query(
    "INSERT INTO notifications (workspace_id, title, body, url) VALUES ($1, $2, $3, $4)",
    [WORKSPACE_ID, title, body, path],
  );
  const { RESEND_API_KEY: key, NOTIFY_EMAIL_FROM: from, NOTIFY_EMAIL_TO: to, APP_URL: appUrl } = process.env;
  if (!key || !from || !to) return;
  const link = appUrl ? new URL(path, appUrl).toString() : path;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: title, text: `${body}\n\n${link}` }),
    });
    if (!res.ok) console.error("notify: email failed", res.status, await res.text());
  } catch (e) {
    console.error("notify: email failed", e);
  }
}

export async function unreadCount(): Promise<number> {
  const { rows } = await db().query<{ n: string }>(
    "SELECT count(*) AS n FROM notifications WHERE workspace_id = $1 AND read_at IS NULL", [WORKSPACE_ID]);
  return Number(rows[0].n);
}
