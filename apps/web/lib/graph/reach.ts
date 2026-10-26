// Reach from "you" to many targets at once: for each of your contacts, a best-first search
// (maximizing the product of edge weights) through people and funds, never passing through
// another of your contacts. Used by the background mapping agent; pure and unit-tested.

import type { Graph, GraphEdge, IntroPath } from "./paths";

export interface Reach {
  best: IntroPath;
  contacts: Set<string>; // first-hop contact ids with any path
}

interface Item { node: string; score: number; depth: number }

class MaxHeap {
  private a: Item[] = [];
  get size() { return this.a.length; }
  push(x: Item) {
    const a = this.a; a.push(x);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (a[p].score >= a[i].score) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop(): Item {
    const a = this.a; const top = a[0]; const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].score > a[m].score) m = l;
        if (r < a.length && a[r].score > a[m].score) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

export function reachAll(
  graph: Graph, targets: Set<string>, opts: { from?: string; maxEdges?: number; minScore?: number } = {},
): Map<string, Reach> {
  const from = opts.from ?? "me";
  const maxEdges = opts.maxEdges ?? 5;
  const minScore = opts.minScore ?? 0.05;
  const kind = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const adj = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e);
    (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e);
  }

  type Visit = { score: number; prev: string | null; edge: GraphEdge | null; depth: number };
  const out = new Map<string, Reach>();
  for (const first of adj.get(from) ?? []) {
    if (first.kind !== "linkedin" && first.kind !== "google") continue;
    const contact = first.source === from ? first.target : first.source;
    const start = first.weight;
    if (start < minScore) continue;

    // Best-first search from this contact. A node's first pop is its best score under the depth bound.
    const best = new Map<string, Visit>();
    best.set(contact, { score: start, prev: from, edge: first, depth: 1 });
    const heap = new MaxHeap();
    heap.push({ node: contact, score: start, depth: 1 });
    const done = new Set<string>();
    while (heap.size) {
      const { node, score, depth } = heap.pop();
      if (done.has(node)) continue;
      done.add(node);
      if (depth >= maxEdges) continue;
      for (const e of adj.get(node) ?? []) {
        const next = e.source === node ? e.target : e.source;
        if (next === from || done.has(next) || kind.get(next) === "contact") continue;
        const s = score * e.weight;
        if (s < minScore) continue;
        const cur = best.get(next);
        if (!cur || s > cur.score) {
          best.set(next, { score: s, prev: node, edge: e, depth: depth + 1 });
          heap.push({ node: next, score: s, depth: depth + 1 });
        }
      }
    }

    for (const t of targets) {
      const hit = best.get(t);
      if (!hit || !done.has(t)) continue;
      const nodes: string[] = [];
      const edges: GraphEdge[] = [];
      for (let n: string | null = t; n && n !== from;) {
        const b: Visit = best.get(n)!;
        nodes.unshift(n);
        edges.unshift(b.edge!);
        n = b.prev;
      }
      nodes.unshift(from);
      const r = out.get(t);
      if (!r) out.set(t, { best: { nodes, edges, score: hit.score }, contacts: new Set([contact]) });
      else {
        r.contacts.add(contact);
        if (hit.score > r.best.score) r.best = { nodes, edges, score: hit.score };
      }
    }
  }
  return out;
}
