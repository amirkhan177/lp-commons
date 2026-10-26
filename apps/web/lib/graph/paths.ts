// Pure intro-path search over a small, undirected, weighted graph.
// Kept free of database code so it can be unit-tested and reused (e.g. by an MCP server later).

export type NodeKind = "me" | "contact" | "person" | "entity";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  detail?: string;
}

export type EdgeKind =
  | "linkedin"   // you <-> contact (LinkedIn connection)
  | "google"     // you <-> contact (Google contact / calendar meetings)
  | "match"      // contact <-> filing person (same human)
  | "works_at"   // contact <-> fund, via LinkedIn company = fund's firm
  | "role"       // filing person <-> fund, from a Form D
  | "same_firm"; // fund <-> sibling fund of the same firm

export interface GraphEdge {
  source: string;
  target: string;
  kind: EdgeKind;
  weight: number; // 0..1, how much this hop helps an intro
  evidence: string;
  url?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface IntroPath {
  nodes: string[];
  edges: GraphEdge[];
  score: number;
}

export interface PathOptions {
  maxEdges?: number;   // default 5: you -> contact -> person -> fund -> person -> target
  limit?: number;      // default 20
  minScore?: number;   // default 0.05
}

/**
 * Simple paths from `from` to `to` up to maxEdges, scored by the product of edge weights, best
 * first. Only the best path through each first-hop contact is kept: the question is "who should
 * I ask?", so one contact's longer detours shouldn't crowd out other people.
 */
export function findPaths(graph: Graph, from: string, to: string, opts: PathOptions = {}): IntroPath[] {
  const maxEdges = opts.maxEdges ?? 5;
  const limit = opts.limit ?? 20;
  const minScore = opts.minScore ?? 0.05;

  const adj = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)!.push(e);
    adj.get(e.target)!.push(e);
  }

  const found: IntroPath[] = [];
  const visited = new Set<string>([from]);
  const nodes = [from];
  const edges: GraphEdge[] = [];

  const walk = (at: string, score: number) => {
    if (at === to) {
      found.push({ nodes: [...nodes], edges: [...edges], score });
      return;
    }
    if (edges.length >= maxEdges) return;
    for (const e of adj.get(at) ?? []) {
      const next = e.source === at ? e.target : e.source;
      const s = score * e.weight;
      if (visited.has(next) || s < minScore) continue;
      // The path must leave "you" through one of your own connections; "you" is never re-entered.
      if (at === from && e.kind !== "linkedin" && e.kind !== "google") continue;
      visited.add(next); nodes.push(next); edges.push(e);
      walk(next, s);
      visited.delete(next); nodes.pop(); edges.pop();
    }
  };
  walk(from, 1);

  found.sort((a, b) => b.score - a.score || a.edges.length - b.edges.length);
  const seen = new Set<string>();
  const out: IntroPath[] = [];
  for (const p of found) {
    const key = p.nodes[1];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/** The subgraph covering the given paths (for highlighting in the visualization). */
export function pathSubgraph(graph: Graph, paths: IntroPath[]): Graph {
  const ids = new Set(paths.flatMap((p) => p.nodes));
  const edgeSet = new Set(paths.flatMap((p) => p.edges));
  return { nodes: graph.nodes.filter((n) => ids.has(n.id)), edges: graph.edges.filter((e) => edgeSet.has(e)) };
}
