import { describe, expect, it } from "vitest";
import { decryptSession, encryptSession, verifyLiveToken } from "../src/crypto";
import { createHmac } from "node:crypto";
import {
  canonicalProfileUrl, cleanLines, headlineRole, parseConnectedOn, parseConnectionCard, parseExperienceItem, personKey,
} from "../src/parse";

describe("connections", () => {
  it("parses a connection card with screen-reader duplicates and buttons", () => {
    const text = `Member’s name
Ana Silva, CFA
Ana Silva, CFA
Member’s occupation
General Partner at Seed Ventures | Pre-seed B2B
Connected on March 15, 2023
Message`;
    expect(parseConnectionCard("/in/Ana-Silva-123/?miniProfileUrn=x", text)).toEqual({
      name: "Ana Silva, CFA", firstName: "Ana", lastName: "Silva", url: "https://www.linkedin.com/in/ana-silva-123",
      headline: "General Partner at Seed Ventures | Pre-seed B2B", position: "General Partner", company: "Seed Ventures",
      connectedOn: "2023-03-15", photoUrl: null,
    });
  });

  it("handles headlines without a company and missing dates", () => {
    const c = parseConnectionCard("https://www.linkedin.com/in/bo/", "Bo Chen (He/Him)\nBuilding things\nMessage")!;
    expect(c).toMatchObject({ firstName: "Bo", lastName: "Chen", company: null, connectedOn: null });
  });

  it("rejects non-profile links", () => {
    expect(parseConnectionCard("/company/acme/", "Acme")).toBeNull();
    expect(canonicalProfileUrl("https://www.linkedin.com/in/jos%C3%A9/details/")).toBe("https://www.linkedin.com/in/josé");
    expect(canonicalProfileUrl("https://www.linkedin.com/in/Jane-Doe-1a2b")).toBe("https://www.linkedin.com/in/jane-doe-1a2b");
  });

  it("parses dates and headlines", () => {
    expect(parseConnectedOn("Connected on 5 Sep 2024")).toBe("2024-09-05");
    expect(parseConnectedOn("Connected on Sept 5, 2024")).toBe("2024-09-05");
    expect(headlineRole("Partner @ Equal Ventures · ex-Google")).toEqual({ position: "Partner", company: "Equal Ventures" });
    expect(cleanLines("a\n\n a \nb\nb\n")).toEqual(["a", "b"]);
  });
});

describe("experience", () => {
  it("parses a single role", () => {
    const text = `Partner
Partner
Equal Ventures · Full-time
Equal Ventures · Full-time
Jan 2020 - Present · 4 yrs 10 mos
New York, United States`;
    expect(parseExperienceItem(text)).toEqual({
      company: "Equal Ventures", titles: ["Partner"], started: "Jan 2020", ended: null, isCurrent: true,
    });
  });

  it("parses grouped roles at one company", () => {
    const text = `Accel
Full-time · 6 yrs 2 mos
Partner
Jan 2022 - Present · 2 yrs 10 mos
Principal
Full-time
Sep 2018 - Dec 2021 · 3 yrs 4 mos
London`;
    expect(parseExperienceItem(text)).toEqual({
      company: "Accel", titles: ["Partner", "Principal"], started: "Sep 2018", ended: null, isCurrent: true,
    });
  });

  it("parses a past role with year-only dates", () => {
    expect(parseExperienceItem("Analyst\nGoldman Sachs\n2014 - 2016 · 2 yrs")).toEqual({
      company: "Goldman Sachs", titles: ["Analyst"], started: "2014", ended: "2016", isCurrent: false,
    });
  });

  it("ignores items without dates", () => {
    expect(parseExperienceItem("Show all 12 experiences")).toBeNull();
  });
});

describe("photos", () => {
  it("keeps only https LinkedIn CDN images", () => {
    const ok = "https://media.licdn.com/dms/image/v2/abc/profile-displayphoto-shrink_100_100/0/1?e=1&v=beta&t=x";
    expect(parseConnectionCard("/in/a-b/", "A B\nPM at X", ok)!.photoUrl).toBe(ok);
    expect(parseConnectionCard("/in/a-b/", "A B", "data:image/gif;base64,R0lG")!.photoUrl).toBeNull();
    expect(parseConnectionCard("/in/a-b/", "A B", "https://evil.example.com/x.png")!.photoUrl).toBeNull();
    expect(parseConnectionCard("/in/a-b/", "A B", "http://media.licdn.com/x.png")!.photoUrl).toBeNull();
  });
});

describe("misc", () => {
  it("normalizes names like the other services", () => {
    expect(personKey("José", "O'Neil")).toBe("jose o neil");
  });

  it("verifies live-view tokens", () => {
    const exp = String(Math.floor(Date.now() / 1000) + 60);
    const sig = createHmac("sha256", "s3cret").update(`sess1.${exp}`).digest("base64url");
    expect(verifyLiveToken("s3cret", "sess1", `${exp}.${sig}`)).toBe(true);
    expect(verifyLiveToken("s3cret", "sess2", `${exp}.${sig}`)).toBe(false);
    expect(verifyLiveToken("other", "sess1", `${exp}.${sig}`)).toBe(false);
    expect(verifyLiveToken("s3cret", "sess1", `${exp}.${sig}`, Date.now() + 120_000)).toBe(false);
  });
});

describe("session encryption", () => {
  it("is per-workspace and tamper-evident", () => {
    process.env.LINKEDIN_SESSION_KEY = "c".repeat(64);
    const state = JSON.stringify({ cookies: [{ name: "li_at", value: "secret-cookie" }] });
    const ct = encryptSession(state, 1);
    expect(ct.startsWith("ls1.")).toBe(true);
    expect(ct).not.toContain("secret-cookie");
    expect(decryptSession(ct, 1)).toBe(state);
    expect(() => decryptSession(ct, 2)).toThrow(); // another user's key + binding
    process.env.LINKEDIN_SESSION_KEY = "d".repeat(64);
    expect(() => decryptSession(ct, 1)).toThrow(); // only this service's key works
  });
});
