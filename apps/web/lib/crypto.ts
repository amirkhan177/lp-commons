import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for secrets at rest (e.g. Google refresh tokens). Key: ENCRYPTION_KEY, 64 hex chars.

function key(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  return Buffer.from(hex, "hex");
}

export function encryptionConfigured(): boolean {
  return /^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY ?? "");
}

/** "v1.<iv>.<tag>.<ciphertext>", all base64url. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(token: string): string {
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognized ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
