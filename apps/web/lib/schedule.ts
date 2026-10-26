// Pure scheduling rules for recurring jobs (unit-tested; no database here).

const HOUR = 3600e3;
const DAY = 24 * HOUR;

export type JobName = "weekly_remap" | "weekly_google_sync" | "freshness_check" | "weekly_digest";

/** Most recent Monday 14:00 UTC at or before `now` (digest goes out Monday morning US time). */
export function digestAnchor(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 14));
  const back = (d.getUTCDay() + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - back);
  if (d > now) d.setUTCDate(d.getUTCDate() - 7);
  return d;
}

export function isDue(job: JobName, lastRun: Date | null, now: Date): boolean {
  switch (job) {
    case "weekly_remap":
    case "weekly_google_sync":
      return !lastRun || now.getTime() - lastRun.getTime() >= 7 * DAY;
    case "freshness_check":
      return !lastRun || now.getTime() - lastRun.getTime() >= 6 * HOUR;
    case "weekly_digest":
      return !lastRun || lastRun < digestAnchor(now);
  }
}

/** Business days (Mon–Fri) strictly after `from` up to and including `to`. */
export function businessDaysBetween(from: Date, to: Date): number {
  let n = 0;
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (d.getTime() < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/**
 * SEC posts filings every business day. The newest filing being more than 3 business days old
 * (room for a holiday plus the 6-hourly schedule) means the scraper has stopped.
 */
export const STALE_AFTER_BUSINESS_DAYS = 3;
export function isStale(latestFiling: Date | null, now: Date): boolean {
  return !latestFiling || businessDaysBetween(latestFiling, now) > STALE_AFTER_BUSINESS_DAYS;
}

/** Re-alert at most once a day while the problem lasts. */
export function shouldAlert(stale: boolean, lastAlert: Date | null, now: Date): boolean {
  return stale && (!lastAlert || now.getTime() - lastAlert.getTime() >= DAY);
}

export interface DigestNumbers { newRaising: number; reachable: number; strong: number; top: string[] }

export function digestText(n: DigestNumbers): { title: string; body: string } {
  const funds = (k: number) => `${k} new fund${k === 1 ? "" : "s"}`;
  if (n.newRaising === 0) {
    return { title: "Your weekly LP Commons digest", body: "No new funds started raising this week." };
  }
  const reach = n.reachable
    ? `${n.reachable} reachable through your network${n.strong ? ` (${n.strong} with a strong path)` : ""}: ${n.top.join(", ")}${n.reachable > n.top.length ? ` and ${n.reachable - n.top.length} more` : ""}.`
    : "None are reachable through your network yet.";
  return { title: `This week: ${funds(n.newRaising)} started raising`, body: `${funds(n.newRaising)} started raising this week. ${reach}` };
}

const BACKGROUND = ["new_filings", "weekly", "startup"];

/**
 * What to tell the user when a run finishes. Runs they started always report; background re-maps
 * (after new filings, weekly) stay quiet unless more funds became reachable.
 */
export function mappingNotice(trigger: string, before: number, stats: { funds_reachable: number; strong_paths: number }):
  { title: string; body: string } | null {
  if (BACKGROUND.includes(trigger)) {
    const gained = stats.funds_reachable - before;
    return gained > 0
      ? { title: `${gained} more fund${gained === 1 ? "" : "s"} reachable`,
          body: `New filings added ${gained} active fund${gained === 1 ? "" : "s"} you can reach. ${stats.funds_reachable} in total, ${stats.strong_paths} with a strong path.` }
      : null;
  }
  return {
    title: "Your intro map is ready",
    body: stats.funds_reachable
      ? `${stats.funds_reachable} active funds are reachable through your network, ${stats.strong_paths} with a strong path.`
      : "No active funds are reachable yet. Import more of your network or review possible matches.",
  };
}
