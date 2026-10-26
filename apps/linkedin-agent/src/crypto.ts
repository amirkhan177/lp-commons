import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

// LinkedIn sessions are encrypted with LINKEDIN_SESSION_KEY, which only this service has: the web
// app, the database, and backups only ever see ciphertext. Each workspace gets its own derived key
// (HKDF), and the ciphertext is bound to its workspace as AES-GCM associated data, so a stored
// session can't be decrypted under, or moved to, another user.

function masterKey(): Buffer {
  const hex = process.env.LINKEDIN_SESSION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("LINKEDIN_SESSION_KEY must be 64 hex characters (32 bytes)");
  return Buffer.from(hex, "hex");
}

function workspaceKey(workspaceId: number): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey(), "lp-commons/linkedin-session", `workspace:${workspaceId}`, 32));
}

const aad = (workspaceId: number) => Buffer.from(`linkedin-session:${workspaceId}`);

/** "ls1.<iv>.<tag>.<ciphertext>", all base64url. */
export function encryptSession(plain: string, workspaceId: number): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", workspaceKey(workspaceId), iv);
  cipher.setAAD(aad(workspaceId));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["ls1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSession(token: string, workspaceId: number): string {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "ls1" || !iv || !tag || !data) throw new Error("Unrecognized session ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", workspaceKey(workspaceId), Buffer.from(iv, "base64url"));
  decipher.setAAD(aad(workspaceId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Live-view token minted by the web app: "<exp>.<hmac(sessionId.exp)>". */
export function verifyLiveToken(secret: string, sessionId: string, token: string, now = Date.now()): boolean {
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) * 1000 < now) return false;
  const want = createHmac("sha256", secret).update(`${sessionId}.${exp}`).digest();
  const got = Buffer.from(sig, "base64url");
  return got.length === want.length && timingSafeEqual(got, want);
}

export function secretMatches(secret: string, presented: string | undefined): boolean {
  if (!presented) return false;
  const a = createHmac("sha256", "cmp").update(secret).digest();
  const b = createHmac("sha256", "cmp").update(presented).digest();
  return timingSafeEqual(a, b);
}
