import { describe, expect, it } from "vitest";
import { findPaths, pathSubgraph, type Graph, type GraphEdge } from "@/lib/graph/paths";

const e = (source: string, target: string, kind: GraphEdge["kind"], weight: number): GraphEdge =>
  ({ source, target, kind, weight, evidence: `${source}-${target}` });

// you -> alice (works at Target's firm)                    : 0.9 * 0.7            = 0.63
// you -> bob = Bob Filer, officer of Target                : 0.75 * 0.9 * 1.0     = 0.675
// you -> carol = Carol Filer, co-GP with Dan on Other fund,
//        Dan is officer of Target                          : 0.6 * 0.5 * 1 * 1 * 1 = 0.3
// you -> erin (no route to target)
const graph: Graph = {
  nodes: [
    { id: "me", kind: "me", label: "You" },
    { id: "c:alice", kind: "contact", label: "Alice" },
    { id: "c:bob", kind: "contact", label: "Bob" },
    { id: "c:carol", kind: "contact", label: "Carol" },
    { id: "c:erin", kind: "contact", label: "Erin" },
    { id: "p:bob", kind: "person", label: "Bob Filer" },
    { id: "p:carol", kind: "person", label: "Carol Filer" },
    { id: "p:dan", kind: "person", label: "Dan Filer" },
    { id: "e:target", kind: "entity", label: "Target Fund II" },
    { id: "e:other", kind: "entity", label: "Other Fund I" },
  ],
  edges: [
    e("me", "c:alice", "linkedin", 0.9),
    e("me", "c:bob", "linkedin", 0.75),
    e("me", "c:carol", "linkedin", 0.6),
    e("me", "c:erin", "linkedin", 0.9),
    e("c:alice", "e:target", "works_at", 0.7),
    e("c:bob", "p:bob", "match", 0.9),
    e("p:bob", "e:target", "role", 1),
    e("c:carol", "p:carol", "match", 0.5),
    e("p:carol", "e:other", "role", 1),
    e("p:dan", "e:other", "role", 1),
    e("p:dan", "e:target", "role", 1),
  ],
};

describe("findPaths", () => {
  it("ranks routes by product of edge weights", () => {
    const paths = findPaths(graph, "me", "e:target");
    expect(paths.map((p) => p.nodes[1])).toEqual(["c:bob", "c:alice", "c:carol"]);
    expect(paths[0].score).toBeCloseTo(0.675);
    expect(paths[2].nodes).toEqual(["me", "c:carol", "p:carol", "e:other", "p:dan", "e:target"]);
    expect(paths[2].score).toBeCloseTo(0.3);
  });

  it("respects maxEdges", () => {
    const paths = findPaths(graph, "me", "e:target", { maxEdges: 3 });
    expect(paths.map((p) => p.nodes[1])).toEqual(["c:bob", "c:alice"]);
  });

  it("drops paths under minScore", () => {
    expect(findPaths(graph, "me", "e:target", { minScore: 0.5 }).map((p) => p.nodes[1])).toEqual(["c:bob", "c:alice"]);
  });

  it("only leaves 'you' through LinkedIn edges", () => {
    const g: Graph = { nodes: graph.nodes, edges: [...graph.edges, e("me", "e:target", "role", 1)] };
    expect(findPaths(g, "me", "e:target").every((p) => p.edges[0].kind === "linkedin")).toBe(true);
  });

  it("keeps only the best path per contact", () => {
    // Bob is also co-GP with Dan on Other fund: a longer, weaker route through the same contact.
    const g: Graph = { nodes: graph.nodes, edges: [...graph.edges, e("p:bob", "e:other", "role", 1)] };
    const viaBob = findPaths(g, "me", "e:target").filter((p) => p.nodes[1] === "c:bob");
    expect(viaBob).toHaveLength(1);
    expect(viaBob[0].nodes).toEqual(["me", "c:bob", "p:bob", "e:target"]);
  });

  it("returns nothing when there is no route", () => {
    expect(findPaths(graph, "me", "e:nowhere")).toEqual([]);
  });

  it("builds the highlighted subgraph", () => {
    const sub = pathSubgraph(graph, findPaths(graph, "me", "e:target", { maxEdges: 3 }));
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(["c:alice", "c:bob", "e:target", "me", "p:bob"]);
    expect(sub.edges).toHaveLength(5);
  });
});
