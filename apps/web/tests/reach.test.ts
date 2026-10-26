import { describe, expect, it } from "vitest";
import { findPaths, type Graph, type GraphEdge } from "@/lib/graph/paths";
import { reachAll } from "@/lib/graph/reach";

const e = (source: string, target: string, kind: GraphEdge["kind"], weight: number): GraphEdge =>
  ({ source, target, kind, weight, evidence: `${source}-${target}` });

// Same fixture shape as paths.test.ts, plus a second target and a colleague edge that must not be used.
const graph: Graph = {
  nodes: [
    { id: "me", kind: "me", label: "You" },
    ...["alice", "bob", "carol", "erin"].map((n) => ({ id: `c:${n}`, kind: "contact" as const, label: n })),
    ...["bob", "carol", "dan"].map((n) => ({ id: `p:${n}`, kind: "person" as const, label: n })),
    ...["target", "other", "third"].map((n) => ({ id: `e:${n}`, kind: "entity" as const, label: n })),
  ],
  edges: [
    e("me", "c:alice", "linkedin", 0.9),
    e("me", "c:bob", "linkedin", 0.75),
    e("me", "c:carol", "linkedin", 0.6),
    e("me", "c:erin", "google", 0.95),
    e("c:alice", "e:target", "works_at", 0.7),
    e("c:erin", "e:target", "works_at", 0.7), // erin is alice's colleague; reaching alice via the fund is not a path
    e("c:bob", "p:bob", "match", 0.9),
    e("p:bob", "e:target", "role", 1),
    e("c:carol", "p:carol", "match", 0.5),
    e("p:carol", "e:other", "role", 1),
    e("p:dan", "e:other", "role", 1),
    e("p:dan", "e:target", "role", 1),
    e("p:dan", "e:third", "role", 0.8),
  ],
};

describe("reachAll", () => {
  const reach = reachAll(graph, new Set(["e:target", "e:other", "e:third", "e:missing"]));

  it("finds the best path to each target", () => {
    const t = reach.get("e:target")!;
    // bob: 0.75 * 0.9 * 1 = 0.675 beats erin: 0.95 * 0.7 = 0.665
    expect(t.best.nodes).toEqual(["me", "c:bob", "p:bob", "e:target"]);
    expect(t.best.score).toBeCloseTo(0.675);
  });

  it("counts every contact that can reach a target", () => {
    expect([...reach.get("e:target")!.contacts].sort()).toEqual(["c:alice", "c:bob", "c:carol", "c:erin"]);
    expect([...reach.get("e:other")!.contacts].sort()).toEqual(["c:alice", "c:bob", "c:carol", "c:erin"]);
  });

  it("agrees with findPaths on the best score", () => {
    for (const t of ["e:target", "e:other", "e:third"]) {
      const viaSearch = findPaths(graph, "me", t)[0];
      expect(reach.get(t)!.best.score).toBeCloseTo(viaSearch.score);
    }
  });

  it("never routes through another contact and skips unreachable targets", () => {
    for (const r of reach.values()) {
      expect(r.best.nodes.slice(2).some((n) => n.startsWith("c:"))).toBe(false);
    }
    expect(reach.has("e:missing")).toBe(false);
  });

  it("respects maxEdges", () => {
    const short = reachAll(graph, new Set(["e:third"]), { maxEdges: 3 });
    expect(short.has("e:third")).toBe(false); // needs you->contact->...->dan->third
  });
});
