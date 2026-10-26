import { describe, expect, it } from "vitest";
import { contactEdges, contactFirmKeys, type ContactRow } from "@/lib/graph/contacts";

const base: ContactRow = {
  id: 7, source: "linkedin", first_name: "Dana", last_name: "Whitfield", company: "Benchmark", position: "Advisor",
  company_firm_key: "benchmark partners", matched_person_id: null, match_status: "none", match_confidence: null,
  connected_on: "2025-06-03", meetings: 0, last_met_on: null, strength: 0.9, experience: [],
};
const funds = new Map([["benchmark partners", ["e:1", "e:2"]], ["northwind", ["e:3"]]]);

describe("contactEdges", () => {
  it("links current and past firms, keeping the strongest link per fund", () => {
    const c: ContactRow = { ...base, experience: [
      { firm: "northwind", company: "Northwind", titles: ["OIR"], started: "Mar 2023", ended: null, current: true },
      { firm: "benchmark partners", company: "Benchmark Partners", titles: ["Principal"], started: "Jan 2015", ended: "Dec 2020", current: false },
    ] };
    const { edges } = contactEdges(c, () => false, funds);
    const works = edges.filter((e) => e.kind === "works_at");
    expect(works.map((e) => [e.target, e.weight])).toEqual([["e:1", 0.7], ["e:2", 0.7], ["e:3", 0.7]]);
    expect(works.find((e) => e.target === "e:3")!.evidence).toContain("work history: OIR at Northwind (Mar 2023–present)");
  });

  it("uses the past-work weight when only history links the firm", () => {
    const c: ContactRow = { ...base, company: "Hooli", company_firm_key: "hooli", experience: [
      { firm: "benchmark partners", company: "Benchmark Partners", titles: ["Principal"], started: "Jan 2015", ended: "Dec 2020", current: false },
    ] };
    const works = contactEdges(c, () => false, funds).edges.filter((e) => e.kind === "works_at");
    expect(works.map((e) => e.weight)).toEqual([0.5, 0.5]);
    expect(works[0].evidence).toBe("LinkedIn work history: Principal at Benchmark Partners (Jan 2015–Dec 2020)");
    expect(contactFirmKeys(c)).toEqual(["hooli", "benchmark partners"]);
  });

  it("always links you to the contact with its strength", () => {
    const [you] = contactEdges(base, () => false, funds).edges;
    expect(you).toMatchObject({ source: "me", target: "c:7", kind: "linkedin", weight: 0.9 });
  });
});
