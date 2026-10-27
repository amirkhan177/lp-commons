import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

// Fetching a URL the user typed, from our server: only public http(s) addresses. The address is
// checked at connect time (custom DNS lookup), so redirects and DNS rebinding can't reach
// internal services either.

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export function isPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;     // carrier-grade NAT
    if (a === 169 && b === 254) return false;               // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return false;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9")
        || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff")) return false;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    return true;
  }
  return false;
}

function safeLookup(hostname: string, options: object, cb: (err: Error | null, address: string | LookupAddress[], family?: number) => void) {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return cb(err, "");
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => !isPublicAddress(a.address))) {
      return cb(new Error("That address isn't publicly reachable."), "");
    }
    const all = (options as { all?: boolean }).all;
    return all ? cb(null, list) : cb(null, list[0].address, list[0].family);
  });
}

export function checkUrl(raw: string): URL {
  const scheme = raw.trim().match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") throw new Error("Only http and https addresses are supported.");
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("That doesn't look like a web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https addresses are supported.");
  if (url.username || url.password) throw new Error("Addresses with credentials aren't supported.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Only standard web ports are supported.");
  if (isIP(url.hostname) && !isPublicAddress(url.hostname)) throw new Error("That address isn't publicly reachable.");
  return url;
}

function getOnce(url: URL): Promise<{ status: number; location?: string; body: string; type: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.get(url, {
      lookup: safeLookup as never,
      timeout: TIMEOUT_MS,
      headers: { "User-Agent": "LP Commons profile drafter (+https://github.com/amirkhan177/lp-commons)", "Accept": "text/html,*/*;q=0.5", "Accept-Encoding": "identity" },
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ status, location: res.headers.location, body: "", type: "" });
      }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(); return resolve({ status, body: Buffer.concat(chunks).toString("utf8"), type: String(res.headers["content-type"] ?? "") }); }
        chunks.push(c);
      });
      res.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8"), type: String(res.headers["content-type"] ?? "") }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("The website took too long to respond.")));
    req.on("error", reject);
  });
}

/** GET a public web page (following up to 3 redirects, each re-checked). Returns HTML text. */
export async function fetchPublicPage(raw: string): Promise<{ url: string; html: string }> {
  let url = checkUrl(raw);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await getOnce(url);
    if (res.location) { url = checkUrl(new URL(res.location, url).toString()); continue; }
    if (res.status >= 400) throw new Error(`The website returned an error (${res.status}).`);
    if (res.type && !/html|text/i.test(res.type)) throw new Error("That address isn't a web page.");
    return { url: url.toString(), html: res.body };
  }
  throw new Error("Too many redirects.");
}
