// Pure parsers over the visible text of LinkedIn pages (innerText split into lines). Text is
// steadier than LinkedIn's generated CSS class names, and these are unit-tested with samples.

export interface Connection {
  name: string;
  firstName: string;
  lastName: string;
  url: string;          // canonical https://www.linkedin.com/in/<slug> (same as apps/web canonicalProfileUrl)
  headline: string | null;
  company: string | null;
  position: string | null;
  connectedOn: string | null; // YYYY-MM-DD
}

export interface ExperienceEntry {
  company: string;
  titles: string[];
  started: string | null;
  ended: string | null;
  isCurrent: boolean;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Screen readers get duplicated text on LinkedIn; collapse consecutive duplicates and blanks. */
export function cleanLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const l = raw.replace(/\s+/g, " ").trim();
    if (l && l !== out[out.length - 1]) out.push(l);
  }
  return out;
}

export function canonicalProfileUrl(href: string): string | null {
  const m = href.match(/\/in\/([^/?#]+)/);
  return m ? `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}` : null;
}

/** "Partner at Equal Ventures | ex-Google" -> { position: "Partner", company: "Equal Ventures" } */
export function headlineRole(headline: string | null): { position: string | null; company: string | null } {
  if (!headline) return { position: null, company: null };
  const first = headline.split(/\s[|•·]\s/)[0];
  const m = first.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  return m ? { position: m[1].trim(), company: m[2].trim() } : { position: null, company: null };
}

/** "Connected on March 15, 2023" / "Connected on 15 Mar 2023" -> "2023-03-15" */
export function parseConnectedOn(line: string): string | null {
  const s = line.replace(/^connected\s+on\s+/i, "").trim();
  let m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  return null;
}

function splitName(name: string): { firstName: string; lastName: string } {
  const clean = name.replace(/,.*$/, "").replace(/\s*\(.*?\)\s*/g, " ").trim(); // drop ", CFA" and "(She/Her)"
  const parts = clean.split(/\s+/);
  return parts.length < 2 ? { firstName: parts[0] ?? "", lastName: "" }
                          : { firstName: parts[0], lastName: parts[parts.length - 1] };
}

const NOISE = /^(message|remove connection|more actions|connected on|member['’]s name|member['’]s occupation|follow|pending)$/i;

/** One connection card: profile link + its visible text lines. */
export function parseConnectionCard(href: string, text: string): Connection | null {
  const url = canonicalProfileUrl(href);
  if (!url) return null;
  const lines = cleanLines(text).filter((l) => !NOISE.test(l));
  const connectedLine = lines.find((l) => /^connected\s+on\s+/i.test(l)) ?? null;
  const rest = lines.filter((l) => l !== connectedLine);
  const name = rest[0];
  if (!name) return null;
  const headline = rest[1] ?? null;
  return { name, ...splitName(name), url, headline, ...headlineRole(headline),
           connectedOn: connectedLine ? parseConnectedOn(connectedLine) : null };
}

const DATE_RANGE = /^((?:[A-Za-z]{3}\s+)?\d{4})\s*[-–—]\s*(present|(?:[A-Za-z]{3}\s+)?\d{4})/i;
const EMPLOYMENT_TYPES = "full-time|part-time|self-employed|freelance|contract|internship|apprenticeship|seasonal";
const EMPLOYMENT_ONLY = new RegExp(`^(${EMPLOYMENT_TYPES})$`, "i");
const EMPLOYMENT_SUFFIX = new RegExp(`\\s·\\s(${EMPLOYMENT_TYPES})$`, "i");
const DURATION_ONLY = /^(?:(full-time|part-time)\s·\s)?(\d+\s+yrs?)?\s*(\d+\s+mos?)?$/i;

/**
 * One top-level item of /details/experience/. Two shapes:
 *   single role:  Title / Company · Full-time / Jan 2020 - Present · 4 yrs / New York ...
 *   grouped:      Company / 6 yrs / Title A / [Full-time] / Jan 2022 - Present / Title B / Jan 2019 - Dec 2021 ...
 */
export function parseExperienceItem(text: string): ExperienceEntry | null {
  const lines = cleanLines(text);
  const rangeAt = lines.flatMap((l, i) => (DATE_RANGE.test(l) ? [i] : []));
  if (!rangeAt.length || rangeAt[0] === 0) return null;
  // Grouped items open with "Company / <total duration>" before the first role's dates.
  const grouped = rangeAt[0] > 2 || (rangeAt[0] === 2 && /\d/.test(lines[1]) && DURATION_ONLY.test(lines[1]));

  let company: string;
  let titles: string[];
  if (grouped) {
    company = lines[0];
    // Each role's title sits just above its dates (or above an employment-type line).
    titles = rangeAt.flatMap((r) => {
      const i = EMPLOYMENT_ONLY.test(lines[r - 1]) ? r - 2 : r - 1;
      return i >= 2 ? [lines[i]] : [];
    });
  } else {
    titles = rangeAt[0] === 2 ? [lines[0]] : [];
    company = (rangeAt[0] === 2 ? lines[1] : lines[0]).split(" · ")[0];
  }
  company = company.replace(EMPLOYMENT_SUFFIX, "").trim();
  if (!company) return null;
  const ranges = rangeAt.map((i) => lines[i].match(DATE_RANGE)!);
  const isCurrent = ranges.some((m) => /present/i.test(m[2]));
  return {
    company,
    titles: [...new Set(titles.map((t) => t.split(" · ")[0]))],
    started: ranges[ranges.length - 1][1],
    ended: isCurrent ? null : ranges[0][2],
    isCurrent,
  };
}

/** Normalized key matching apps/web personKey and pipelines person_key. */
export function personKey(first: string, last: string): string {
  return `${first} ${last}`.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
