"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import type { Graph, GraphEdge, GraphNode, IntroPath, NodeKind } from "@/lib/graph/paths";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type Palette = Record<"primary" | "me" | "contact" | "person" | "entity" | "text" | "muted" | "line" | "surface", string>;
const FALLBACK: Palette = {
  primary: "#2a85ff", me: "#171717", contact: "#059669", person: "#b45309", entity: "#7c3aed",
  text: "#171717", muted: "#737373", line: "#d4d4d4", surface: "#ffffff",
};

/** Read the theme's CSS variables so the canvas matches light and dark mode. */
function usePalette(): Palette {
  const [p, setP] = useState(FALLBACK);
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
      setP({
        primary: v("--primary", FALLBACK.primary), me: v("--text", FALLBACK.me), contact: v("--ok", FALLBACK.contact),
        person: v("--warn", FALLBACK.person), entity: v("--violet", FALLBACK.entity), text: v("--text", FALLBACK.text),
        muted: v("--muted", FALLBACK.muted), line: v("--border-strong", FALLBACK.line), surface: v("--surface", FALLBACK.surface),
      });
    };
    read();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    window.addEventListener("themechange", read);
    return () => { mq.removeEventListener("change", read); window.removeEventListener("themechange", read); };
  }, []);
  return p;
}

const KIND_LABEL: Record<NodeKind, string> = { me: "You", contact: "Your contact", person: "Person on filing", entity: "Fund or firm" };
const LINK_LABEL: Record<string, string> = {
  linkedin: "knows", google: "met", match: "is", works_at: "works at", role: "principal of", same_firm: "sister fund",
};
const TAG: Record<string, [string, string]> = {
  linkedin: ["LinkedIn", "you"], google: ["Calendar", "you"], match: ["Name match", ""],
  works_at: ["Work history", "you"], role: ["Form D", "formd"], same_firm: ["Same firm", ""],
};
const MAX_ZOOM = 2.4;

type FGNode = GraphNode & { x?: number; y?: number };
type FGLink = { source: string | FGNode; target: string | FGNode; kind: string };
const endId = (v: string | FGNode) => (typeof v === "string" ? v : v.id);

function meter(score: number) {
  const on = Math.max(1, Math.round(score * 5));
  return <span className="meter" aria-hidden>{[5, 7, 9, 11, 14].map((h, i) => <i key={i} className={i < on ? "on" : ""} style={{ height: h }} />)}</span>;
}

export default function PathExplorer({ graph, paths, targetId }: { graph: Graph; paths: IntroPath[]; targetId: string }) {
  const [selected, setSelected] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods | undefined>(undefined);
  const [size, setSize] = useState({ w: 600, h: 560 });
  const [still, setStill] = useState(false); // prefers-reduced-motion

  useEffect(() => {
    const update = () => setSize({ w: wrap.current?.clientWidth ?? 600, h: wrap.current?.clientHeight ?? 560 });
    update();
    window.addEventListener("resize", update);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(mq.matches);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    // The graph component mounts lazily; spread nodes out once its ref is ready.
    const id = setInterval(() => {
      const g = fg.current;
      if (!g) return;
      clearInterval(id);
      (g.d3Force("charge") as unknown as { strength: (v: number) => void } | undefined)?.strength(-240);
      (g.d3Force("link") as unknown as { distance: (v: number) => void } | undefined)?.distance(70);
      g.d3ReheatSimulation();
    }, 50);
    return () => clearInterval(id);
  }, [graph]);

  const labels = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const data = useMemo(() => ({
    nodes: graph.nodes.map((n) => ({ ...n })),
    links: graph.edges.map((e) => ({ source: e.source, target: e.target, kind: e.kind })),
  }), [graph]);

  const active = paths[selected];
  const activeNodes = new Set(active?.nodes ?? []);
  const activeEdges = new Set(active?.edges.flatMap((e) => [`${e.source}|${e.target}`, `${e.target}|${e.source}`]) ?? []);
  const isActive = (l: FGLink) => activeEdges.has(`${endId(l.source)}|${endId(l.target)}`);
  const C = usePalette();
  const colorOf = (n: FGNode) => (n.id === targetId ? C.primary : C[n.kind]);
  const hops = (active?.edges.length ?? 1) - 1;

  return (
    <div className="stack-lg">
      <div className="card tight">
        <div className="graph-stage" ref={wrap}>
          <ForceGraph2D
            ref={fg}
            graphData={data}
            width={size.w}
            height={size.h}
            backgroundColor="rgba(0,0,0,0)"
            autoPauseRedraw={still}
            cooldownTicks={120}
            onEngineStop={() => {
              const g = fg.current;
              if (!g) return;
              g.zoomToFit(0, Math.min(90, size.w * 0.1));
              // Small graphs would otherwise be blown up to fill the stage: cap zoom, keep centered.
              if (g.zoom() > MAX_ZOOM) {
                const b = g.getGraphBbox();
                g.centerAt((b.x[0] + b.x[1]) / 2, (b.y[0] + b.y[1]) / 2, 0);
                g.zoom(MAX_ZOOM, 300);
              }
            }}
            nodeRelSize={6}
            linkColor={(l) => (isActive(l as FGLink) ? C.primary : C.line)}
            linkWidth={(l) => (isActive(l as FGLink) ? 2.4 : 1)}
            linkDirectionalParticles={(l) => (!still && isActive(l as FGLink) ? 2 : 0)}
            linkDirectionalParticleWidth={3.5}
            linkDirectionalParticleSpeed={0.006}
            linkDirectionalParticleColor={() => C.primary}
            nodeCanvasObject={(n, ctx, scale) => {
              const node = n as FGNode;
              const x = node.x ?? 0, y = node.y ?? 0;
              const on = activeNodes.has(node.id);
              const isTarget = node.id === targetId;
              const color = colorOf(node);
              const r = isTarget ? 8 : node.kind === "me" ? 7 : node.kind === "entity" ? 5.5 : 5;
              ctx.save();
              ctx.globalAlpha = on || !active || isTarget ? 1 : 0.35;
              if (isTarget || node.kind === "me") { // soft halo
                ctx.beginPath(); ctx.arc(x, y, r + 6, 0, Math.PI * 2);
                ctx.fillStyle = color; ctx.globalAlpha *= 0.15; ctx.fill(); ctx.globalAlpha = 1;
              }
              ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.fillStyle = color; ctx.fill();
              ctx.lineWidth = 2 / Math.max(scale * 0.6, 0.6);
              ctx.strokeStyle = C.surface; ctx.stroke();
              if (on || isTarget || node.kind === "me" || scale > 2.4) {
                const fs = Math.max(11 / scale, 2.8);
                ctx.font = `${isTarget || node.kind === "me" ? 700 : 600} ${fs}px Inter, ui-sans-serif, system-ui, sans-serif`;
                ctx.textAlign = "center";
                ctx.fillStyle = on || isTarget ? C.text : C.muted;
                const label = node.kind === "me" ? "You" : node.label;
                ctx.fillText(label.length > 34 ? label.slice(0, 33) + "…" : label, x, y + r + 4 + fs);
              }
              ctx.restore();
            }}
            nodePointerAreaPaint={(n, color, ctx) => {
              const node = n as FGNode;
              ctx.fillStyle = color;
              ctx.beginPath(); ctx.arc(node.x ?? 0, node.y ?? 0, 10, 0, Math.PI * 2); ctx.fill();
            }}
            nodeLabel={(n) => {
              const node = n as FGNode;
              return `${node.label} · ${KIND_LABEL[node.kind]}${node.detail ? " · " + node.detail : ""}`;
            }}
            onNodeClick={(n) => {
              const idx = paths.findIndex((p) => p.nodes.includes((n as FGNode).id));
              if (idx >= 0) setSelected(idx);
            }}
          />
          <div className="graph-stats" aria-hidden>
            <span>Route {selected + 1} of {paths.length}</span>
            <span>Strength {Math.round((active?.score ?? 0) * 100)}%</span>
            <span>{hops} hop{hops === 1 ? "" : "s"} past your contact</span>
          </div>
        </div>
        <div className="legend">
          {(Object.keys(KIND_LABEL) as NodeKind[]).map((k) => (
            <span key={k}><i style={{ background: C[k] }} />{KIND_LABEL[k]}</span>
          ))}
          <span><i style={{ background: C.primary }} />Selected fund</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><h2>Intro routes</h2><p>{paths.length} route{paths.length === 1 ? "" : "s"}, strongest first. Select one to see the evidence for each hop.</p></div></div>
        {paths.map((p, i) => (
          <div key={i} className={`route${i === selected ? " selected" : ""}`} onClick={() => setSelected(i)}
               role="button" tabIndex={0} aria-pressed={i === selected} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSelected(i))}>
            <div className="route-head">
              <b>Route {i + 1}</b>
              <span>{meter(p.score)}{Math.round(p.score * 100)}% · {p.edges.length - 1} hop{p.edges.length === 2 ? "" : "s"}</span>
            </div>
            <div className="chain">
              {p.nodes.map((id, j) => {
                const n = labels.get(id);
                const cls = id === targetId ? "target" : n?.kind ?? "entity";
                return (
                  <span key={id} style={{ display: "contents" }}>
                    {j > 0 && <span className="link">{LINK_LABEL[p.edges[j - 1].kind] ?? p.edges[j - 1].kind}</span>}
                    <span className={`node ${cls}`}>{id === "me" ? "You" : n?.label}</span>
                  </span>
                );
              })}
            </div>
            {i === selected && <Intel edges={p.edges} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function Intel({ edges }: { edges: GraphEdge[] }) {
  return (
    <ul className="intel">
      {edges.map((e, j) => {
        const [tag, cls] = TAG[e.kind] ?? ["Data", ""];
        return (
          <li key={j}>
            <span className={`tag ${cls}`}>{tag}</span>
            <span>{e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.evidence}</a> : e.evidence}</span>
          </li>
        );
      })}
    </ul>
  );
}
