import { describe, expect, it } from "vitest";
import { htmlToText, relevantLinks } from "@/lib/thesis/extract";
import { blend, scoreFit, type Candidate } from "@/lib/thesis/fit";
import { checkUrl, isPublicAddress } from "@/lib/thesis/net";
import { errorDetail, friendlyError, maskKey, modelUnavailable, parseJson } from "@/lib/thesis/openrouter";
import { cleanDraft, keywordDraft, sectorsIn, type FundProfileDraft } from "@/lib/thesis/taxonomy";

const profile: FundProfileDraft = {
  fund_name: "Northlight Fund II", summary: "Seed climate software", sectors: ["climate", "enterprise"], stages: ["seed"],
  geographies: ["us"], fund_number: 2, target_size: 40e6, check_min: 5e5, check_max: 2e6, lp_types: ["fof", "family_office"], keywords: [],
};
const fund = (o: Partial<Candidate>): Candidate => ({ id: 1, name: "X", type: "vc_fund", state: "CA", vintage: 2025, raised: 40e6, raise_status: "raising", managers: [], ...o });

describe("network safety", () => {
  it("only allows public addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["8.8.8.8", "151.101.1.69", "2606:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
  });
  it("rejects bad URLs", () => {
    expect(checkUrl("northlight.vc").toString()).toBe("https://northlight.vc/");
    expect(() => checkUrl("file:///etc/passwd")).toThrow();
    expect(() => checkUrl("http://169.254.169.254/latest")).toThrow(/publicly/);
    expect(() => checkUrl("http://user:pw@example.com")).toThrow();
    expect(() => checkUrl("http://example.com:5432")).toThrow(/ports/);
  });
});

describe("extraction", () => {
  const html = `<html><head><title>Northlight Ventures | Seed climate</title><meta name="description" content="We back climate &amp; energy software."></head>
    <body><script>evil()</script><h1>Climate software at seed</h1><p>Fund II: $40M fund. Checks $500K - $2M.</p>
    <a href="/about">About</a><a href="/thesis/">Thesis</a><a href="https://other.com/team">x</a><a href="/blog/post">b</a></body></html>`;
  it("strips markup and finds thesis pages", () => {
    const t = htmlToText(html);
    expect(t.title).toBe("Northlight Ventures | Seed climate");
    expect(t.description).toBe("We back climate & energy software.");
    expect(t.text).not.toContain("evil");
    expect(relevantLinks(html, "https://northlight.vc/")).toEqual(["https://northlight.vc/about", "https://northlight.vc/thesis/"]);
  });
  it("drafts a profile from keywords without an LLM", () => {
    const t = htmlToText(html);
    const d = keywordDraft(t.title, `${t.description} ${t.text} climate energy software software`);
    expect(d.fund_name).toBe("Northlight Ventures");
    expect(d.sectors).toContain("climate");
    expect(d.stages).toEqual(["seed"]);
    expect(d.fund_number).toBe(2);
    expect(d.target_size).toBe(40e6);
    expect([d.check_min, d.check_max]).toEqual([5e5, 2e6]);
  });
  it("cleans model output to known values", () => {
    const d = cleanDraft({ sectors: ["climate", "unicorns"], stages: ["seed"], target_size: "$40M", fund_number: 99, lp_types: ["fof", "aliens"], keywords: ["vertical AI"] });
    expect(d).toMatchObject({ sectors: ["climate"], target_size: 40e6, fund_number: null, lp_types: ["fof"], keywords: ["vertical AI"] });
  });
});

describe("openrouter helpers", () => {
  it("parses JSON from chatty answers", () => {
    expect(parseJson<{ a: number }>('Sure! ```json\n{"a": 1, "b": "x}"}\n``` done')).toEqual({ a: 1, b: "x}" });
    expect(parseJson<number[]>("Here: [1, [2], 3] ok")).toEqual([1, [2], 3]);
    expect(() => parseJson("no json here")).toThrow();
  });
  it("masks keys", () => {
    expect(maskKey("sk-or-v1-abcdef0123456789")).toBe("sk-or-…6789");
  });
});

describe("fit", () => {
  it("ranks a focused emerging-manager fund of funds above an unrelated one", () => {
    const good = scoreFit(profile, fund({ type: "fof", name: "Climate Emerging Managers Fund of Funds II", raise_status: "fresh_capital" }));
    const off = scoreFit(profile, fund({ type: "fof", name: "Crypto Growth FoF", raise_status: "quiet", state: "X0" }));
    expect(good.kind).toBe("fof");
    expect(good.score).toBeGreaterThan(80);
    expect(off.score).toBeLessThan(40);
    expect(good.reasons[0]).toMatch(/Climate/);
  });
  it("scores peers on sector, size and region, capped without sector overlap", () => {
    const peer = scoreFit(profile, fund({ name: "Greenline Climate Seed Fund II", raised: 35e6 }));
    const noSector = scoreFit(profile, fund({ name: "Acme Ventures III", raised: 40e6 }));
    expect(peer.score).toBeGreaterThan(70);
    expect(noSector.score).toBeLessThanOrEqual(35);
  });
  it("sinks non-venture funds of funds", () => {
    const hedge = scoreFit(profile, fund({ type: "fof", name: "Proteus Absolute Return Hedge Fund of Funds I", raise_status: "raising" }));
    expect(hedge.score).toBeLessThan(25);
    expect(hedge.reasons[0]).toBe("Allocates mainly outside venture");
  });

  it("downweights funds of funds when the GP doesn't target them", () => {
    const fof = fund({ type: "fof", name: "Climate Fund of Funds", raise_status: "fresh_capital" });
    expect(scoreFit({ ...profile, lp_types: ["family_office"] }, fof).score).toBeLessThan(scoreFit(profile, fof).score);
  });
  it("blends LLM scores", () => {
    expect(blend(50, null)).toBe(50);
    expect(blend(50, 100)).toBe(80);
    expect(sectorsIn("GC AI Health Fund")).toEqual(["ai", "health"]);
  });
});

describe("openrouter errors", () => {
  it("detects models that can't be served and explains them", () => {
    const body = '{"error":{"message":"No allowed providers are available for the selected model."}}';
    expect(errorDetail(body)).toBe("No allowed providers are available for the selected model.");
    expect(modelUnavailable(404, errorDetail(body))).toBe(true);
    expect(modelUnavailable(400, "anthropic/foo is not a valid model ID")).toBe(true);
    expect(modelUnavailable(402, "Insufficient credits")).toBe(false);
    expect(modelUnavailable(401, "bad key")).toBe(false);
    expect(friendlyError(404, errorDetail(body))).toMatch(/settings\/privacy/);
    expect(friendlyError(402, "")).toMatch(/credits/);
  });
});
