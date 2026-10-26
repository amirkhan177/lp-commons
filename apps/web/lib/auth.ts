import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export { SESSION_COOKIE } from "./constants";
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;
const MIN_PASSWORD_LENGTH = 12;

function secret(): string | null {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= 32 ? s : null;
}

function safeEqual(a: string, b: string): boolean {
  // Hash first so lengths match and timing doesn't leak the length.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Fails closed: no login is possible until ADMIN_PASSWORD (>= 12 chars) and SESSION_SECRET are set. */
export function authConfigured(): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  return Boolean(pw && pw.length >= MIN_PASSWORD_LENGTH && secret());
}

export function checkPassword(input: string): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  if (!authConfigured() || !pw) return false;
  return safeEqual(input, pw);
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function createSessionToken(now = Date.now()): string {
  const key = secret();
  if (!key) throw new Error("SESSION_SECRET is not set (needs >= 32 chars)");
  const exp = String(Math.floor(now / 1000) + SESSION_TTL_SECONDS);
  return `${exp}.${sign(exp, key)}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
  const key = secret();
  if (!key || !token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < now) return false;
  return safeEqual(sig, sign(exp, key));
}
