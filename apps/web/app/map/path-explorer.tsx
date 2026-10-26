"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import type { Graph, GraphEdge, GraphNode, IntroPath, NodeKind } from "@/lib/graph/paths";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

// Mission-mode palette (kept in sync with the .hud tokens in globals.css).
const C = {
  cyan: "#00e5ff", target: "#ff2e63", me: "#ffffff",
  contact: "#39ff88", person: "#ffb000", entity: "#b98aff", text: "#d6f7ff", dim: "rgba(0,229,255,0.13)",
};
const KIND_COLOR: Record<NodeKind, string> = { me: C.me, contact: C.contact, person: C.person, entity: C.entity };
const KIND_LABEL: Record<NodeKind, string> = { me: "Operator (you)", contact: "Your contact", person: "Filing principal", entity: "Fund" };
const LINK_LABEL: Record<string, string> = {
  linkedin: "knows", google: "met", match: "is", works_at: "works at", role: "principal of", same_firm: "sister fund",
};
const TAG: Record<string, [string, string]> = {
  linkedin: ["[LINKEDIN]", "you"], google: ["[CALENDAR]", "you"], match: ["[ID MATCH]", ""],
  works_at: ["[WORK HIST]", "you"], role: ["[FORM D]", "formd"], same_firm: ["[FIRM]", ""],
};
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const MAX_ZOOM = 2.4;

type FGNode = GraphNode & { x?: number; y?: number };
type FGLink = { source: string | FGNode; target: string | FGNode; kind: string };
const endId = (v: string | FGNode) => (typeof v === "string" ? v : v.id);

function glyph(ctx: CanvasRenderingContext2D, kind: NodeKind, x: number, y: number, r: number) {
  ctx.beginPath();
  if (kind === "contact") {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      ctx[i ? "lineTo" : "moveTo"](x + r * Math.cos(a), y + r * Math.sin(a));
    }
    ctx.closePath();
  } else if (kind === "person") {
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
  } else if (kind === "entity") {
    ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}

function signalBars(score: number) {
  const on = Math.max(1, Math.round(score * 5));
  return <span className="signal" aria-hidden>{[4, 6, 8, 10, 12].map((h, i) => <i key={i} className={i < on ? "on" : ""} style={{ height: h }} />)}</span>;
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
  const t0 = useRef(performance.now());

  return (
    <div className="stack">
      <div className="hud-stage" ref={wrap}>
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
          linkColor={(l) => (isActive(l as FGLink) ? C.cyan : C.dim)}
          linkWidth={(l) => (isActive(l as FGLink) ? 2.2 : 0.8)}
          linkDirectionalParticles={(l) => (!still && isActive(l as FGLink) ? 3 : 0)}
          linkDirectionalParticleWidth={3.2}
          linkDirectionalParticleSpeed={0.007}
          linkDirectionalParticleColor={() => C.cyan}
          onRenderFramePre={(ctx, scale) => {
            // Radar: range rings around the target plus a rotating sweep.
            const tgt = data.nodes.find((n) => n.id === targetId) as FGNode | undefined;
            const cx = tgt?.x ?? 0, cy = tgt?.y ?? 0;
            const t = (performance.now() - t0.current) / 1000;
            ctx.save();
            ctx.lineWidth = 1 / scale;
            for (let r = 50; r <= 400; r += 50) {
              ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
              ctx.strokeStyle = `rgba(0,229,255,${r % 100 === 0 ? 0.1 : 0.05})`; ctx.stroke();
            }
            ctx.strokeStyle = "rgba(0,229,255,0.07)";
            ctx.beginPath(); ctx.moveTo(cx - 420, cy); ctx.lineTo(cx + 420, cy); ctx.moveTo(cx, cy - 420); ctx.lineTo(cx, cy + 420); ctx.stroke();
            if (!still && "createConicGradient" in ctx) {
              const a = (t * 0.9) % (Math.PI * 2);
              const g = ctx.createConicGradient(a, cx, cy);
              g.addColorStop(0, "rgba(0,229,255,0.16)");
              g.addColorStop(0.08, "rgba(0,229,255,0)");
              g.addColorStop(1, "rgba(0,229,255,0)");
              ctx.fillStyle = g;
              ctx.beginPath(); ctx.arc(cx, cy, 400, 0, Math.PI * 2); ctx.fill();
            }
            ctx.restore();
          }}
          nodeCanvasObject={(n, ctx, scale) => {
            const node = n as FGNode;
            const x = node.x ?? 0, y = node.y ?? 0;
            const on = activeNodes.has(node.id);
            const isTarget = node.id === targetId;
            const t = (performance.now() - t0.current) / 1000;
            const color = isTarget ? C.target : KIND_COLOR[node.kind];
            const r = isTarget ? 7 : node.kind === "me" ? 6 : node.kind === "entity" ? 5 : 4.5;
            ctx.save();
            ctx.globalAlpha = on || !active || isTarget ? 1 : 0.3;
            ctx.shadowColor = color;
            ctx.shadowBlur = on || isTarget ? 16 : 6;
            glyph(ctx, node.kind, x, y, r);
            ctx.fillStyle = node.kind === "me" || isTarget ? color : "rgba(3,7,12,0.9)";
            ctx.fill();
            ctx.lineWidth = 1.6 / Math.max(scale * 0.6, 0.6);
            ctx.strokeStyle = color;
            ctx.stroke();

            if (node.kind === "me") { // operator: double ring
              ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.lineWidth = 0.8; ctx.stroke();
            }
            if (isTarget) { // reticle: rotating brackets + expanding pulse
              const spin = still ? 0 : t * 1.4;
              ctx.lineWidth = 1.4;
              for (let i = 0; i < 4; i++) {
                const a = spin + (Math.PI / 2) * i;
                ctx.beginPath(); ctx.arc(x, y, r + 7, a, a + Math.PI / 4); ctx.stroke();
              }
              if (!still) {
                const p = (t % 1.6) / 1.6;
                ctx.globalAlpha = 1 - p;
                ctx.beginPath(); ctx.arc(x, y, r + 6 + p * 22, 0, Math.PI * 2); ctx.lineWidth = 1; ctx.stroke();
                ctx.globalAlpha = 1;
              }
              ctx.shadowBlur = 0;
              ctx.beginPath();
              ctx.moveTo(x - r - 16, y); ctx.lineTo(x - r - 9, y); ctx.moveTo(x + r + 9, y); ctx.lineTo(x + r + 16, y);
              ctx.moveTo(x, y - r - 16); ctx.lineTo(x, y - r - 9); ctx.moveTo(x, y + r + 9); ctx.lineTo(x, y + r + 16);
              ctx.stroke();
            }
            if (on || isTarget || node.kind === "me" || scale > 2.4) {
              ctx.shadowBlur = 0;
              const fs = Math.max(10 / scale, 2.6);
              ctx.font = `${fs}px ${MONO}`;
              ctx.textAlign = "center";
              ctx.fillStyle = isTarget ? C.target : on ? C.text : "rgba(214,247,255,0.6)";
              const label = (node.kind === "me" ? "YOU" : node.label).toUpperCase();
              ctx.fillText(label.length > 34 ? label.slice(0, 33) + "…" : label, x, y + r + (isTarget ? 22 : 9) + fs);
              if (isTarget) {
                ctx.font = `${fs * 0.85}px ${MONO}`;
                ctx.fillText("◎ TARGET", x, y - r - 20);
              }
            }
            ctx.restore();
          }}
          nodePointerAreaPaint={(n, color, ctx) => {
            const node = n as FGNode;
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(node.x ?? 0, node.y ?? 0, 9, 0, Math.PI * 2); ctx.fill();
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
        {!still && <div className="hud-scan" />}
        <div className="hud-overlay" aria-hidden>
          <div className="tl">Link analysis<br />{graph.nodes.length} nodes · {graph.edges.length} links</div>
          <div className="tr">Signal<br /><b style={{ color: "#fff", fontSize: 18 }}>{Math.round((active?.score ?? 0) * 100)}%</b></div>
          <div className="bl">Route {String(selected + 1).padStart(2, "0")} / {String(paths.length).padStart(2, "0")}<br />{(active?.edges.length ?? 1) - 1} hop{active?.edges.length === 2 ? "" : "s"} past your contact</div>
          <div className="br"><span className="lock">◉ Target locked</span></div>
        </div>
      </div>
      <div className="hud-legend">
        {(Object.keys(KIND_LABEL) as NodeKind[]).map((k) => (
          <span key={k}><i style={{ background: KIND_COLOR[k], color: KIND_COLOR[k] }} />{KIND_LABEL[k]}</span>
        ))}
        <span><i style={{ background: C.target, color: C.target }} />Target</span>
      </div>

      <h2 className="hud-title" style={{ marginTop: 10 }}>Intro routes · {paths.length}</h2>
      {paths.map((p, i) => (
        <div key={i} className={`route${i === selected ? " selected" : ""}`} onClick={() => setSelected(i)}
             role="button" tabIndex={0} aria-pressed={i === selected} onKeyDown={(e) => e.key === "Enter" && setSelected(i)}>
          <div className="route-head">
            <b>Route {String(i + 1).padStart(2, "0")}</b>
            <span>{signalBars(p.score)} {Math.round(p.score * 100)}% · {p.edges.length - 1} hop{p.edges.length === 2 ? "" : "s"}</span>
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
  );
}

function Intel({ edges }: { edges: GraphEdge[] }) {
  return (
    <ul className="intel">
      {edges.map((e, j) => {
        const [tag, cls] = TAG[e.kind] ?? ["[DATA]", ""];
        return (
          <li key={j}>
            <span className={`tag ${cls}`}>{tag}</span>
            {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.evidence}</a> : e.evidence}
          </li>
        );
      })}
    </ul>
  );
}
