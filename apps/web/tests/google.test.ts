import { afterEach, describe, expect, it } from "vitest";
import { aggregateGoogle, type GEvent } from "@/lib/google/aggregate";
import { decrypt, encrypt } from "@/lib/crypto";
import { googleStrength } from "@/lib/graph/weights";
import { newAuthRequest } from "@/lib/google/oauth";

const meeting = (day: string, ...others: { email: string; displayName?: string; responseStatus?: string }[]): GEvent => ({
  start: { dateTime: `${day}T15:00:00Z` },
  attendees: [{ email: "me@example.com", self: true, responseStatus: "accepted" }, ...others],
});

describe("aggregateGoogle", () => {
  const out = aggregateGoogle(
    [{ names: [{ givenName: "Ana", familyName: "Silva" }], emailAddresses: [{ value: "Ana@Seed.vc" }],
       organizations: [{ name: "Seed Ventures", title: "GP" }] }],
    [{ names: [{ displayName: "Bo Chen" }], emailAddresses: [{ value: "bo@ex.com" }] },
     { emailAddresses: [{ value: "noname@ex.com" }] }],
    [
      meeting("2026-01-10", { email: "ana@seed.vc" }),
      meeting("2026-05-02", { email: "ana@seed.vc" }, { email: "bo@ex.com", responseStatus: "declined" }),
      meeting("2025-03-01", { email: "cara@ex.com", displayName: "Cara Diaz Lopez" }),
      { status: "cancelled", start: { date: "2026-06-01" }, attendees: [{ email: "me@example.com", self: true }, { email: "ana@seed.vc" }] },
      { start: { date: "2026-06-02" }, attendees: Array.from({ length: 30 }, (_, i) => ({ email: `p${i}@big.com`, self: i === 0, displayName: `P ${i}` })) },
      { start: { date: "2026-06-03" }, attendees: [{ email: "x@ex.com", displayName: "X Y" }] }, // you weren't there
    ],
  );
  const by = new Map(out.map((c) => [c.email, c]));

  it("merges contacts and meetings by lowercase email", () => {
    expect(by.get("ana@seed.vc")).toEqual({ email: "ana@seed.vc", firstName: "Ana", lastName: "Silva",
      company: "Seed Ventures", position: "GP", meetings: 2, lastMetOn: "2026-05-02" });
  });

  it("splits display names and skips declined, cancelled, huge and not-attended meetings", () => {
    expect(by.get("bo@ex.com")).toMatchObject({ firstName: "Bo", lastName: "Chen", meetings: 0 });
    expect(by.get("cara@ex.com")).toMatchObject({ firstName: "Cara", lastName: "Lopez", meetings: 1 });
    expect([...by.keys()].some((k) => k.endsWith("@big.com"))).toBe(false);
    expect(by.has("x@ex.com")).toBe(false);
  });

  it("drops people without a name", () => {
    expect(by.has("noname@ex.com")).toBe(false);
    expect(by.has("me@example.com")).toBe(false);
  });
});

describe("googleStrength", () => {
  const today = new Date("2026-10-26");
  it("ranks recent repeated meetings highest", () => {
    expect(googleStrength(5, "2026-09-01", today)).toBe(0.95);
    expect(googleStrength(1, "2026-08-01", today)).toBe(0.9);
    expect(googleStrength(4, "2023-01-01", today)).toBe(0.85);
    expect(googleStrength(1, "2023-01-01", today)).toBe(0.7);
    expect(googleStrength(0, null, today)).toBe(0.55);
  });
});

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; });

describe("crypto", () => {
  it("round-trips and detects tampering", () => {
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    const c = encrypt("1//refresh-token");
    expect(c).not.toContain("refresh");
    expect(decrypt(c)).toBe("1//refresh-token");
    const [v, iv, tag, data] = c.split(".");
    const flipped = data[0] === "A" ? "B" + data.slice(1) : "A" + data.slice(1);
    expect(() => decrypt([v, iv, tag, flipped].join("."))).toThrow();
    process.env.ENCRYPTION_KEY = "b".repeat(64);
    expect(() => decrypt(c)).toThrow();
  });

  it("refuses a bad key", () => {
    process.env.ENCRYPTION_KEY = "short";
    expect(() => encrypt("x")).toThrow(/64 hex/);
  });
});

describe("Google auth request", () => {
  it("uses PKCE, offline access and read-only scopes", () => {
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.APP_URL = "https://lp.example.com";
    const { url, state, verifier } = newAuthRequest();
    const q = new URL(url).searchParams;
    expect(q.get("state")).toBe(state);
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).not.toBe(verifier);
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("redirect_uri")).toBe("https://lp.example.com/api/google/callback");
    expect(q.get("scope")!.split(" ").every((s) => s.endsWith(".readonly"))).toBe(true);
  });
});
