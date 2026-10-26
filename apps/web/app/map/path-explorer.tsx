"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import type { Graph, GraphNode, IntroPath, NodeKind } from "@/lib/graph/paths";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const KIND_LABEL: Record<NodeKind, string> = { me: "You", contact: "Your connection", person: "Person in filings", entity: "Fund" };
const EDGE_LABEL: Record<string, string> = {
  linkedin: "knows", match: "is", works_at: "works at", role: "on", same_firm: "same firm as",
};

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

type FGNode = GraphNode & { x?: number; y?: number };
type FGLink = { source: string | FGNode; target: string | FGNode; kind: string };

export default function PathExplorer({ graph, paths }: { graph: Graph; paths: IntroPath[] }) {
  const [selected, setSelected] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods | undefined>(undefined);
  const [width, setWidth] = useState(600);
  const [colors, setColors] = useState<Record<string, string>>({});

  useEffect(() => {
    const update = () => setWidth(wrap.current?.clientWidth ?? 600);
    update();
    window.addEventListener("resize", update);
    setColors({
      me: cssVar("--node-me", "#2f5bd3"), contact: cssVar("--node-contact", "#1f7a4d"),
      person: cssVar("--node-person", "#8a4fd1"), entity: cssVar("--node-entity", "#c2670a"),
      text: cssVar("--text", "#1c1c1a"), muted: cssVar("--border", "#e3e3de"), accent: cssVar("--accent", "#2f5bd3"),
    });
    return () => window.removeEventListener("resize", update);
  }, []);
  const labels = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const data = useMemo(() => ({
    nodes: graph.nodes.map((n) => ({ ...n })),
    links: graph.edges.map((e) => ({ source: e.source, target: e.target, kind: e.kind })),
  }), [graph]);

  const active = paths[selected];
  const activeNodes = new Set(active?.nodes ?? []);
  const activeEdges = new Set(active?.edges.map((e) => `${e.source}|${e.target}`) ?? []);
  const linkKey = (l: FGLink) => {
    const s = typeof l.source === "string" ? l.source : l.source.id;
    const t = typeof l.target === "string" ? l.target : l.target.id;
    return `${s}|${t}`;
  };

  return (
    <div className="stack">
      <div className="graph-wrap" ref={wrap}>
        <ForceGraph2D
          ref={fg}
          // Extra padding for small graphs so a handful of nodes isn't blown up to fill the canvas.
          onEngineStop={() => fg.current?.zoomToFit(400, data.nodes.length < 12 ? 140 : 50)}
          graphData={data}
          width={width}
          height={560}
          cooldownTicks={120}
          nodeRelSize={5}
          linkWidth={(l) => (activeEdges.has(linkKey(l as FGLink)) ? 3 : 1)}
          linkColor={(l) => (activeEdges.has(linkKey(l as FGLink)) ? colors.accent : colors.muted)}
          nodeCanvasObject={(n, ctx, scale) => {
            const node = n as FGNode;
            const on = activeNodes.has(node.id);
            const r = node.kind === "me" || node.kind === "entity" ? 7 : 5;
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
            ctx.fillStyle = colors[node.kind] ?? "#888";
            ctx.globalAlpha = on || !active ? 1 : 0.35;
            ctx.fill();
            ctx.globalAlpha = 1;
            if (on || scale > 2.2) {
              ctx.font = `${12 / scale}px system-ui, sans-serif`;
              ctx.fillStyle = colors.text;
              ctx.textAlign = "center";
              ctx.fillText(node.label, node.x ?? 0, (node.y ?? 0) + r + 12 / scale);
            }
          }}
          nodeLabel={(n) => {
            const node = n as FGNode;
            return `${node.label} — ${KIND_LABEL[node.kind]}${node.detail ? " · " + node.detail : ""}`;
          }}
          onNodeClick={(n) => {
            const idx = paths.findIndex((p) => p.nodes.includes((n as FGNode).id));
            if (idx >= 0) setSelected(idx);
          }}
        />
      </div>
      <div className="legend">
        {(Object.keys(KIND_LABEL) as NodeKind[]).map((k) => (
          <span key={k}><span className="dot" style={{ background: colors[k] }} />{KIND_LABEL[k]}</span>
        ))}
      </div>

      <h3 style={{ margin: "8px 0 0" }}>{paths.length} intro path{paths.length === 1 ? "" : "s"}</h3>
      {paths.map((p, i) => (
        <div key={i} className={`path${i === selected ? " selected" : ""}`} onClick={() => setSelected(i)}
             role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSelected(i)}>
          <div className="small muted">Strength {(p.score * 100).toFixed(0)}% · {p.edges.length - 1} hop{p.edges.length === 2 ? "" : "s"} after your connection</div>
          <div className="path-steps">
            {p.nodes.map((id, j) => (
              <span key={id} style={{ display: "contents" }}>
                {j > 0 && <span className="arrow">{EDGE_LABEL[p.edges[j - 1].kind]} →</span>}
                <span className="step" style={{ borderColor: colors[labels.get(id)?.kind ?? "entity"] }}>{labels.get(id)?.label}</span>
              </span>
            ))}
          </div>
          {i === selected && (
            <ul className="evidence">
              {p.edges.map((e, j) => (
                <li key={j}>{e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.evidence}</a> : e.evidence}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
