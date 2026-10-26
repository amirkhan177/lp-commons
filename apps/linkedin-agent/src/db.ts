import pg from "pg";
import { config, WORKSPACE_ID } from "./config.js";
import { decryptSession, encryptSession } from "./crypto.js";
import { personKey, type Connection, type ExperienceEntry } from "./parse.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3 });

export type Status = "connected" | "needs_login" | "challenge" | "paused";

export async function saveSession(storageState: string, status: Status = "connected"): Promise<void> {
  await pool.query(
    `INSERT INTO integrations (workspace_id, provider, refresh_token, scopes, status, status_detail)
     VALUES ($1, 'linkedin', $2, 'browser-session', $3, NULL)
     ON CONFLICT (workspace_id, provider) DO UPDATE SET refresh_token = EXCLUDED.refresh_token,
       status = EXCLUDED.status, status_detail = NULL`,
    [WORKSPACE_ID, encryptSession(storageState, WORKSPACE_ID), status],
  );
}

export async function loadSession(): Promise<{ state: string; status: Status; lastSyncedAt: Date | null } | null> {
  const row = (await pool.query<{ refresh_token: string; status: Status; last_synced_at: Date | null }>(
    "SELECT refresh_token, status, last_synced_at FROM integrations WHERE workspace_id = $1 AND provider = 'linkedin'",
    [WORKSPACE_ID])).rows[0];
  return row ? { state: decryptSession(row.refresh_token, WORKSPACE_ID), status: row.status, lastSyncedAt: row.last_synced_at } : null;
}

export async function setStatus(status: Status, detail: string | null): Promise<void> {
  await pool.query(
    "UPDATE integrations SET status = $2, status_detail = $3 WHERE workspace_id = $1 AND provider = 'linkedin'",
    [WORKSPACE_ID, status, detail]);
}

const YEAR = 365.25 * 864e5;
function strength(connectedOn: string | null): number {
  if (!connectedOn) return 0.6;
  const y = (Date.now() - new Date(connectedOn).getTime()) / YEAR;
  return y <= 2 ? 0.9 : y <= 5 ? 0.75 : 0.6; // same as apps/web linkedinStrength
}

export async function upsertConnections(list: Connection[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const c of list) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO user_contacts (workspace_id, source, first_name, last_name, linkedin_url, company, position,
                                    headline, connected_on, name_key)
         VALUES ($1, 'linkedin', $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (workspace_id, linkedin_url) DO UPDATE SET
           first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, headline = EXCLUDED.headline,
           company = COALESCE(user_contacts.company, EXCLUDED.company),
           position = COALESCE(user_contacts.position, EXCLUDED.position),
           connected_on = COALESCE(EXCLUDED.connected_on, user_contacts.connected_on), name_key = EXCLUDED.name_key
         RETURNING id`,
        [WORKSPACE_ID, c.firstName, c.lastName, c.url, c.company, c.position, c.headline, c.connectedOn,
         personKey(c.firstName, c.lastName)],
      );
      await client.query(
        `INSERT INTO user_edges (workspace_id, contact_id, kind, strength, evidence) VALUES ($1, $2, 'linkedin', $3, $4)
         ON CONFLICT (workspace_id, contact_id, kind) DO UPDATE SET strength = EXCLUDED.strength, evidence = EXCLUDED.evidence`,
        [WORKSPACE_ID, rows[0].id, strength(c.connectedOn), JSON.stringify({ connected_on: c.connectedOn })],
      );
    }
    await client.query(
      `UPDATE integrations SET last_synced_at = now(),
         last_sync_stats = COALESCE(last_sync_stats, '{}'::jsonb) || jsonb_build_object('connections', $2::int)
       WHERE workspace_id = $1 AND provider = 'linkedin'`, [WORKSPACE_ID, list.length]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function profilesEnrichedToday(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM user_contacts WHERE workspace_id = $1 AND source = 'linkedin'
       AND enriched_at >= date_trunc('day', now())`, [WORKSPACE_ID]);
  return Number(rows[0].n);
}

/** Never-visited profiles first (most recent connections first), then ones older than 90 days. */
export async function profilesToVisit(limit: number): Promise<{ id: number; linkedin_url: string }[]> {
  const { rows } = await pool.query<{ id: number; linkedin_url: string }>(
    `SELECT id, linkedin_url FROM user_contacts
     WHERE workspace_id = $1 AND source = 'linkedin' AND linkedin_url LIKE 'https://www.linkedin.com/in/%'
       AND (enriched_at IS NULL OR enriched_at < now() - interval '90 days')
     ORDER BY enriched_at NULLS FIRST, connected_on DESC NULLS LAST LIMIT $2`, [WORKSPACE_ID, limit]);
  return rows;
}

export async function saveExperience(contactId: number, entries: ExperienceEntry[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM user_contact_experience WHERE contact_id = $1", [contactId]);
    for (const [i, e] of entries.entries()) {
      await client.query(
        `INSERT INTO user_contact_experience (contact_id, position, company, titles, started, ended, is_current)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`, [contactId, i, e.company, e.titles, e.started, e.ended, e.isCurrent]);
    }
    const current = entries.find((e) => e.isCurrent);
    await client.query(
      `UPDATE user_contacts SET enriched_at = now(),
         company = COALESCE($2, company), position = COALESCE($3, position)
       WHERE id = $1`, [contactId, current?.company ?? null, current?.titles[0] ?? null]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function notifyUser(title: string, body: string, url: string): Promise<void> {
  await pool.query("INSERT INTO notifications (workspace_id, title, body, url) VALUES ($1, $2, $3, $4)",
                   [WORKSPACE_ID, title, body, url]);
}
