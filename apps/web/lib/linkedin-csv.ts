// Parses LinkedIn's "Connections.csv" data export. The export starts with a few "Notes:" lines
// before the real header row, so we scan for the header instead of assuming line 1.

export interface LinkedInContact {
  firstName: string;
  lastName: string;
  url: string | null;
  email: string | null;
  company: string | null;
  position: string | null;
  connectedOn: string | null; // ISO date
}

/** RFC 4180-style CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "15 Mar 2023" -> "2023-03-15"; also accepts ISO dates. */
export function parseConnectedOn(value: string): string | null {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  return month ? `${m[3]}-${month}-${m[1].padStart(2, "0")}` : null;
}

const clean = (v: string | undefined) => (v ?? "").trim() || null;

export function parseLinkedInConnections(text: string): LinkedInContact[] {
  const rows = parseCsv(text);
  const headerIdx = rows.findIndex((r) => r[0]?.trim().toLowerCase() === "first name");
  if (headerIdx < 0) throw new Error("Not a LinkedIn Connections.csv: no 'First Name' header row found.");
  const header = rows[headerIdx].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const idx = {
    first: col("first name"), last: col("last name"), url: col("url"), email: col("email address"),
    company: col("company"), position: col("position"), connected: col("connected on"),
  };
  const out: LinkedInContact[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const firstName = clean(r[idx.first]);
    const lastName = clean(r[idx.last]);
    if (!firstName && !lastName) continue;
    const connected = clean(r[idx.connected]);
    out.push({
      firstName: firstName ?? "",
      lastName: lastName ?? "",
      url: (() => { const u = clean(r[idx.url]); return u ? canonicalProfileUrl(u) ?? u : null; })(),
      email: idx.email >= 0 ? clean(r[idx.email]) : null,
      company: clean(r[idx.company]),
      position: clean(r[idx.position]),
      connectedOn: connected ? parseConnectedOn(connected) : null,
    });
  }
  return out;
}

/** https://www.linkedin.com/in/<slug>, lowercase, no trailing slash (same as apps/linkedin-agent). */
export function canonicalProfileUrl(href: string): string | null {
  const m = href.match(/\/in\/([^/?#]+)/);
  return m ? `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}` : null;
}

/** Mirrors pipelines/src/lpmap/normalize.py person_key(): first + last, ASCII, lowercase. */
export function personKey(first: string, last: string): string {
  return `${first} ${last}`
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
