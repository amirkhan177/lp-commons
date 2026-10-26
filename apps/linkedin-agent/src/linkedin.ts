import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { config } from "./config.js";
import { canonicalProfileUrl, parseConnectionCard, parseExperienceItem, type Connection, type ExperienceEntry } from "./parse.js";

export const SESSION_COOKIE = "li_at";
export const VIEWPORT = { width: 1280, height: 800 };

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser?.isConnected()) {
    // The container is the sandbox boundary; Chromium's own sandbox needs privileges Railway doesn't grant.
    browser = await chromium.launch({ headless: true, chromiumSandbox: false, args: ["--disable-dev-shm-usage"] });
  }
  return browser;
}

export async function newContext(storageState?: string): Promise<BrowserContext> {
  return (await getBrowser()).newContext({
    viewport: VIEWPORT,
    locale: "en-US", // parsers read English UI text
    storageState: storageState ? JSON.parse(storageState) : undefined,
  });
}

export type Blocked = "needs_login" | "challenge" | null;

/** LinkedIn wants a human: we stop and ask the user. Never solved or bypassed automatically. */
export async function blockedState(page: Page): Promise<Blocked> {
  const url = page.url();
  if (/\/checkpoint\/|\/challenge|captcha/i.test(url)) return "challenge";
  if (/\/login|\/authwall|\/signup|\/uas\//i.test(url)) return "needs_login";
  if (await page.$('iframe[src*="captcha" i], #captcha-internal')) return "challenge";
  return null;
}

export const linkedinUrl = (path: string) => config.baseUrl + path;
export const toBase = (canonical: string) => canonical.replace("https://www.linkedin.com", config.baseUrl);

export const pause = (min: number, max: number) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

/** Your own 1st-degree connections, by scrolling the connections page like a person would. */
export async function collectConnections(page: Page): Promise<{ connections: Connection[]; blocked: Blocked }> {
  await page.goto(linkedinUrl("/mynetwork/invite-connect/connections/"), { waitUntil: "domcontentloaded" });
  await pause(2000, 4000);
  const blocked = await blockedState(page);
  if (blocked) return { connections: [], blocked };

  let last = -1;
  let stable = 0;
  for (let round = 0; round < 400 && stable < 3; round++) {
    const count = await page.locator('main a[href*="/in/"]').count();
    stable = count === last ? stable + 1 : 0;
    last = count;
    const more = page.getByRole("button", { name: /show more results|load more/i });
    if (await more.isVisible().catch(() => false)) await more.click().catch(() => {});
    await page.mouse.wheel(0, 2500 + Math.random() * 1500);
    await pause(1500, 3500);
    if (await blockedState(page)) return { connections: [], blocked: await blockedState(page) };
  }

  const cards = await page.evaluate(() => {
    const out = new Map<string, { href: string; text: string }>();
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('main a[href*="/in/"]'))) {
      const href = a.getAttribute("href") ?? "";
      const card = a.closest("li, [role='listitem']") ?? a.parentElement?.parentElement ?? a;
      const text = (card as HTMLElement).innerText ?? "";
      const key = href.split("?")[0];
      if (!out.has(key) || text.length > out.get(key)!.text.length) out.set(key, { href, text });
    }
    return [...out.values()];
  });
  const seen = new Set<string>();
  const connections: Connection[] = [];
  for (const c of cards) {
    const parsed = parseConnectionCard(c.href, c.text);
    if (parsed && !seen.has(parsed.url)) { seen.add(parsed.url); connections.push(parsed); }
  }
  return { connections, blocked: null };
}

/** The Experience section of one connection's profile. */
export async function collectExperience(page: Page, profileUrl: string): Promise<{ entries: ExperienceEntry[]; blocked: Blocked }> {
  const canonical = canonicalProfileUrl(profileUrl);
  if (!canonical) return { entries: [], blocked: null };
  await page.goto(toBase(canonical) + "/details/experience/", { waitUntil: "domcontentloaded" });
  await pause(2500, 5000);
  const blocked = await blockedState(page);
  if (blocked) return { entries: [], blocked };
  await page.mouse.wheel(0, 800 + Math.random() * 800);
  await pause(1000, 2500);
  const items = await page.evaluate(() => {
    // Top-level list of the experience section; nested lists hold grouped roles.
    const top = Array.from(document.querySelectorAll("main ul"))
      .find((ul) => !ul.parentElement?.closest("ul") && ul.querySelector(":scope > li"));
    return top ? Array.from(top.querySelectorAll(":scope > li")).map((li) => (li as HTMLElement).innerText) : [];
  });
  return { entries: items.map(parseExperienceItem).filter((e): e is ExperienceEntry => !!e), blocked: null };
}
