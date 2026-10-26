"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Status = "connecting" | "live" | "done" | "error";
const SPECIAL = new Set(["Enter", "Backspace", "Tab", "Escape", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

export default function LiveLogin({ wsUrl }: { wsUrl: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ws = useRef<WebSocket | null>(null);
  const size = useRef({ width: 1280, height: 800 });
  const [status, setStatus] = useState<Status>("connecting");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const sock = new WebSocket(wsUrl);
    ws.current = sock;
    const img = new Image();
    img.onload = () => canvas.current?.getContext("2d")?.drawImage(img, 0, 0, size.current.width, size.current.height);
    sock.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.t === "hello") {
        size.current = { width: msg.width, height: msg.height };
        if (canvas.current) { canvas.current.width = msg.width; canvas.current.height = msg.height; }
        setStatus("live");
      } else if (msg.t === "frame") {
        img.src = `data:image/jpeg;base64,${msg.data}`;
      } else if (msg.t === "done") {
        setStatus("done");
      } else if (msg.t === "error") {
        setStatus("error");
        setMessage(msg.message);
      }
    };
    sock.onclose = () => setStatus((s) => (s === "done" ? s : s === "error" ? s : "error"));
    return () => sock.close();
  }, [wsUrl]);

  const send = (m: object) => ws.current?.readyState === 1 && ws.current.send(JSON.stringify(m));
  const toPage = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * size.current.width, y: ((e.clientY - r.top) / r.height) * size.current.height };
  };

  if (status === "done") {
    return (
      <div className="card stack">
        <p style={{ margin: 0 }}><span className="badge ok">LinkedIn connected</span></p>
        <p style={{ margin: 0 }}>
          The agent will now read your connections and their work history in the background, slowly and within a
          daily limit. Your map updates as it goes and you&apos;ll get a notification on <Link href="/reach">Reach</Link>.
        </p>
      </div>
    );
  }
  return (
    <div className="stack">
      {status === "connecting" && <p className="muted">Opening a browser…</p>}
      {status === "error" && (
        <p className="error">{message || "The login window closed."} <Link href="/settings">Back to Settings</Link></p>
      )}
      <canvas
        ref={canvas}
        tabIndex={0}
        aria-label="Remote LinkedIn login window"
        style={{ width: "100%", maxWidth: 1280, aspectRatio: "1280 / 800", border: "1px solid var(--border)",
                 borderRadius: 8, background: "#fff", outline: "none", display: status === "error" ? "none" : "block" }}
        onClick={(e) => { e.currentTarget.focus(); send({ t: "click", ...toPage(e) }); }}
        onWheel={(e) => send({ t: "wheel", dy: e.deltaY })}
        onKeyDown={(e) => {
          if (e.metaKey || e.ctrlKey) return; // let paste etc. through to onPaste
          if (SPECIAL.has(e.key)) { e.preventDefault(); send({ t: "key", key: e.key }); }
          else if (e.key.length === 1) { e.preventDefault(); send({ t: "key", key: e.key }); }
        }}
        onPaste={(e) => { e.preventDefault(); send({ t: "text", text: e.clipboardData.getData("text").slice(0, 512) }); }}
      />
    </div>
  );
}
