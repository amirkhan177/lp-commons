// Pure: turns Google People + Calendar API responses into one record per email address.

export interface GPerson {
  names?: { givenName?: string; familyName?: string; displayName?: string }[];
  emailAddresses?: { value?: string }[];
  organizations?: { name?: string; title?: string }[];
}

export interface GEvent {
  status?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string }[];
}

export interface GoogleContact {
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  position: string | null;
  meetings: number;
  lastMetOn: string | null; // YYYY-MM-DD
}

const MAX_ATTENDEES = 15; // big meetings say little about whether you know someone

function splitName(display: string): { first: string | null; last: string | null } {
  const parts = display.trim().split(/\s+/);
  if (parts.length < 2) return { first: parts[0] || null, last: null };
  return { first: parts[0], last: parts[parts.length - 1] };
}

export function aggregateGoogle(connections: GPerson[], otherContacts: GPerson[], events: GEvent[]): GoogleContact[] {
  const byEmail = new Map<string, GoogleContact>();
  const upsert = (email: string | undefined, name?: { first: string | null; last: string | null },
                  org?: { name?: string; title?: string }) => {
    const key = email?.trim().toLowerCase();
    if (!key || !key.includes("@")) return undefined;
    let c = byEmail.get(key);
    if (!c) {
      c = { email: key, firstName: null, lastName: null, company: null, position: null, meetings: 0, lastMetOn: null };
      byEmail.set(key, c);
    }
    if (name && !c.lastName && (name.first || name.last)) { c.firstName = name.first; c.lastName = name.last; }
    if (org?.name && !c.company) { c.company = org.name; c.position = org.title ?? null; }
    return c;
  };

  // Address-book contacts first (best names and companies), then people you've emailed.
  for (const p of [...connections, ...otherContacts]) {
    const n = p.names?.[0];
    const name = n?.familyName || n?.givenName
      ? { first: n?.givenName ?? null, last: n?.familyName ?? null }
      : n?.displayName ? splitName(n.displayName) : undefined;
    for (const e of p.emailAddresses ?? []) upsert(e.value, name, p.organizations?.[0]);
  }

  for (const ev of events) {
    if (ev.status === "cancelled") continue;
    const attendees = (ev.attendees ?? []).filter((a) => !a.resource);
    if (attendees.length < 2 || attendees.length > MAX_ATTENDEES) continue;
    const me = attendees.find((a) => a.self);
    if (!me || me.responseStatus === "declined") continue;
    const day = (ev.start?.dateTime ?? ev.start?.date ?? "").slice(0, 10) || null;
    for (const a of attendees) {
      if (a.self || a.responseStatus === "declined") continue;
      const c = upsert(a.email, a.displayName ? splitName(a.displayName) : undefined);
      if (!c) continue;
      c.meetings++;
      if (day && (!c.lastMetOn || day > c.lastMetOn)) c.lastMetOn = day;
    }
  }
  // Without a name we can't match anyone to the filings.
  return [...byEmail.values()].filter((c) => c.lastName);
}
