import "server-only";
import { decrypt } from "../crypto";
import { db, WORKSPACE_ID } from "../db";
import { googleStrength } from "../graph/weights";
import { runMatching } from "../import";
import { personKey } from "../linkedin-csv";
import { aggregateGoogle, type GEvent, type GPerson } from "./aggregate";
import { accessToken } from "./oauth";

const CALENDAR_LOOKBACK_DAYS = 730;
const MAX_PAGES = 50;

async function pages<T>(token: string, url: URL, key: string): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Google API ${url.pathname} failed (${res.status})`);
    const body = await res.json();
    out.push(...(body[key] ?? []));
    if (!body.nextPageToken) break;
    url.searchParams.set("pageToken", body.nextPageToken);
  }
  return out;
}

export async function syncGoogle(): Promise<{ contacts: number; met: number }> {
  const pool = db();
  const integ = (await pool.query<{ refresh_token: string }>(
    "SELECT refresh_token FROM integrations WHERE workspace_id = $1 AND provider = 'google'", [WORKSPACE_ID])).rows[0];
  if (!integ) throw new Error("Google is not connected");
  const token = await accessToken(decrypt(integ.refresh_token));

  const people = new URL("https://people.googleapis.com/v1/people/me/connections");
  people.search = "personFields=names,emailAddresses,organizations&pageSize=1000";
  const others = new URL("https://people.googleapis.com/v1/otherContacts");
  others.search = "readMask=names,emailAddresses&pageSize=1000";
  const cal = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  cal.search = new URLSearchParams({
    timeMin: new Date(Date.now() - CALENDAR_LOOKBACK_DAYS * 864e5).toISOString(),
    timeMax: new Date().toISOString(),
    singleEvents: "true",
    maxResults: "2500",
    fields: "items(status,start,attendees(email,displayName,self,resource,responseStatus)),nextPageToken",
  }).toString();

  const contacts = aggregateGoogle(
    await pages<GPerson>(token, people, "connections"),
    await pages<GPerson>(token, others, "otherContacts"),
    await pages<GEvent>(token, cal, "items"),
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const c of contacts) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO user_contacts (workspace_id, source, first_name, last_name, email, company, position,
                                    name_key, meetings, last_met_on)
         VALUES ($1, 'google', $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (workspace_id, (lower(email))) WHERE source = 'google' DO UPDATE SET
           first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, company = EXCLUDED.company,
           position = EXCLUDED.position, name_key = EXCLUDED.name_key, meetings = EXCLUDED.meetings,
           last_met_on = EXCLUDED.last_met_on
         RETURNING id`,
        [WORKSPACE_ID, c.firstName, c.lastName, c.email, c.company, c.position,
         personKey(c.firstName ?? "", c.lastName ?? ""), c.meetings, c.lastMetOn],
      );
      await client.query(
        `INSERT INTO user_edges (workspace_id, contact_id, kind, strength, evidence)
         VALUES ($1, $2, 'google', $3, $4)
         ON CONFLICT (workspace_id, contact_id, kind) DO UPDATE SET strength = EXCLUDED.strength,
           evidence = EXCLUDED.evidence`,
        [WORKSPACE_ID, rows[0].id, googleStrength(c.meetings, c.lastMetOn),
         JSON.stringify({ meetings: c.meetings, last_met_on: c.lastMetOn })],
      );
    }
    const stats = { contacts: contacts.length, met: contacts.filter((c) => c.meetings > 0).length };
    await client.query(
      "UPDATE integrations SET last_synced_at = now(), last_sync_stats = $2 WHERE workspace_id = $1 AND provider = 'google'",
      [WORKSPACE_ID, JSON.stringify(stats)]);
    await client.query("COMMIT");
    await runMatching();
    return stats;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
