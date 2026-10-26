import "server-only";
import { db, WORKSPACE_ID } from "./db";
import { linkedinStrength } from "./graph/weights";
import { personKey, type LinkedInContact } from "./linkedin-csv";

export async function importContacts(contacts: LinkedInContact[]): Promise<{ imported: number }> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    let imported = 0;
    for (const c of contacts) {
      // Contacts without a profile URL get a stable synthetic key so re-imports stay idempotent.
      const url = c.url ?? `noprofile:${personKey(c.firstName, c.lastName)}:${(c.company ?? "").toLowerCase()}`;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO user_contacts (workspace_id, first_name, last_name, linkedin_url, email, company, position,
                                    connected_on, name_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (workspace_id, linkedin_url) DO UPDATE SET
           first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email,
           company = EXCLUDED.company, position = EXCLUDED.position, connected_on = EXCLUDED.connected_on,
           name_key = EXCLUDED.name_key
         RETURNING id`,
        [WORKSPACE_ID, c.firstName, c.lastName, url, c.email, c.company, c.position, c.connectedOn,
         personKey(c.firstName, c.lastName)],
      );
      await client.query(
        `INSERT INTO user_edges (workspace_id, contact_id, kind, strength, evidence)
         VALUES ($1, $2, 'linkedin', $3, $4)
         ON CONFLICT (workspace_id, contact_id, kind) DO UPDATE SET strength = EXCLUDED.strength,
           evidence = EXCLUDED.evidence`,
        [WORKSPACE_ID, rows[0].id, linkedinStrength(c.connectedOn),
         JSON.stringify({ connected_on: c.connectedOn })],
      );
      imported++;
    }
    await client.query("COMMIT");
    return { imported };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Deterministic contact -> filing-person matching. A contact matches a person with the same
 * normalized name when:
 *   - 'auto' (0.9):     exactly one same-name person has a role at a fund whose firm matches the
 *                       contact's company or any firm in their LinkedIn work history;
 *   - 'possible' (0.5): the name is unique among filing people but nothing corroborates it.
 * Ambiguous names stay unmatched. 'confirmed' / 'rejected' decisions are never overwritten.
 */
export async function runMatching(): Promise<{ auto: number; possible: number }> {
  const pool = db();
  await pool.query(
    `UPDATE user_contacts SET matched_person_id = NULL, match_confidence = NULL, match_status = 'none'
     WHERE workspace_id = $1 AND match_status IN ('auto', 'possible')`,
    [WORKSPACE_ID],
  );
  await pool.query(
    `WITH cand AS (
       SELECT c.id AS contact_id, p.id AS person_id,
              EXISTS (SELECT 1 FROM roles r JOIN entities e ON e.id = r.entity_id
                      WHERE r.person_id = p.id AND (e.firm_key = c.company_firm_key OR e.firm_key IN (
                        SELECT company_firm_key FROM user_contact_experience x WHERE x.contact_id = c.id))) AS corroborated
       FROM user_contacts c JOIN people p ON p.name_normalized = c.name_key
       WHERE c.workspace_id = $1 AND c.match_status = 'none' AND c.name_key <> ''
     ), ranked AS (
       SELECT *, count(*) OVER (PARTITION BY contact_id) AS n,
                 count(*) FILTER (WHERE corroborated) OVER (PARTITION BY contact_id) AS nc
       FROM cand
     )
     UPDATE user_contacts c SET
       matched_person_id = r.person_id,
       match_status = CASE WHEN r.corroborated THEN 'auto' ELSE 'possible' END,
       match_confidence = CASE WHEN r.corroborated THEN 0.9 ELSE 0.5 END
     FROM ranked r
     WHERE c.id = r.contact_id AND ((r.corroborated AND r.nc = 1) OR (r.n = 1 AND r.nc = 0))`,
    [WORKSPACE_ID],
  );
  const { rows } = await pool.query<{ auto: string; possible: string }>(
    `SELECT count(*) FILTER (WHERE match_status IN ('auto', 'confirmed')) AS auto,
            count(*) FILTER (WHERE match_status = 'possible') AS possible
     FROM user_contacts WHERE workspace_id = $1`,
    [WORKSPACE_ID],
  );
  return { auto: Number(rows[0].auto), possible: Number(rows[0].possible) };
}

export async function setMatchDecision(contactId: number, decision: "confirmed" | "rejected"): Promise<void> {
  await db().query(
    `UPDATE user_contacts SET match_status = $3,
       match_confidence = CASE WHEN $3 = 'confirmed' THEN 1.0 ELSE NULL END
     WHERE workspace_id = $1 AND id = $2 AND matched_person_id IS NOT NULL`,
    [WORKSPACE_ID, contactId, decision],
  );
}

export async function deleteAllContacts(): Promise<void> {
  await db().query("DELETE FROM user_contacts WHERE workspace_id = $1", [WORKSPACE_ID]);
}
