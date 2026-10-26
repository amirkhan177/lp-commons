import { afterEach, describe, expect, it } from "vitest";
import { authConfigured, checkPassword, createSessionToken, verifySessionToken } from "@/lib/auth";

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; });

function configure() {
  process.env.ADMIN_PASSWORD = "correct horse battery";
  process.env.SESSION_SECRET = "x".repeat(40);
}

describe("auth", () => {
  it("fails closed when not configured", () => {
    delete process.env.ADMIN_PASSWORD;
    expect(authConfigured()).toBe(false);
    expect(checkPassword("")).toBe(false);
    process.env.ADMIN_PASSWORD = "short";
    process.env.SESSION_SECRET = "x".repeat(40);
    expect(authConfigured()).toBe(false);
    expect(checkPassword("short")).toBe(false);
  });

  it("checks the password", () => {
    configure();
    expect(checkPassword("correct horse battery")).toBe(true);
    expect(checkPassword("wrong")).toBe(false);
  });

  it("signs and verifies session tokens", () => {
    configure();
    const now = Date.now();
    const token = createSessionToken(now);
    expect(verifySessionToken(token, now)).toBe(true);
    expect(verifySessionToken(token, now + 8 * 24 * 3600 * 1000)).toBe(false); // expired
    const [exp, sig] = token.split(".");
    expect(verifySessionToken(`${Number(exp) + 1000}.${sig}`, now)).toBe(false); // tampered expiry
    process.env.SESSION_SECRET = "y".repeat(40);
    expect(verifySessionToken(token, now)).toBe(false); // rotated secret
  });
});
