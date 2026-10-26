import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { crawl } from "./crawler.js";
import { secretMatches, verifyLiveToken } from "./crypto.js";
import { LiveSession } from "./live.js";

const sessions = new Map<string, LiveSession>();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://agent");
  const json = (code: number, body: object) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };

  if (req.method === "GET" && url.pathname === "/health") return json(200, { ok: true });

  // Internal endpoints: only the web service (same shared secret) may call them.
  if (url.pathname.startsWith("/internal/")) {
    if (req.method !== "POST" || !secretMatches(config.sharedSecret, req.headers["x-agent-secret"] as string)) {
      return json(403, { error: "forbidden" });
    }
    if (url.pathname === "/internal/login") {
      for (const s of sessions.values()) await s.close("Replaced by a new login window."); // one at a time
      const s = new LiveSession(() => void crawl(), (closed) => sessions.delete(closed.id));
      sessions.set(s.id, s);
      try {
        await s.start();
      } catch (e) {
        await s.close("Could not open LinkedIn.");
        return json(502, { error: (e as Error).message });
      }
      return json(200, { sessionId: s.id });
    }
    if (url.pathname === "/internal/crawl") {
      void crawl();
      return json(202, { ok: true });
    }
  }
  json(404, { error: "not found" });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://agent");
  const id = url.searchParams.get("s") ?? "";
  const session = sessions.get(id);
  if (url.pathname !== "/live" || !session || !verifyLiveToken(config.sharedSecret, id, url.searchParams.get("t") ?? "")) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => session.attach(ws));
});

// Railway's private network is IPv6; "::" also accepts IPv4.
server.listen(config.port, "::", () => console.log(`linkedin-agent listening on ${config.port}`));
setInterval(() => void crawl(), config.tickMs);
setTimeout(() => void crawl(), 15_000);
