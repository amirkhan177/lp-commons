import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Link to the optional LinkedIn agent service (apps/linkedin-agent). Off unless explicitly enabled.

export function linkedinAgentEnabled(): boolean {
  const e = process.env;
  return e.LINKEDIN_AGENT_ENABLED === "true" && Boolean(e.AGENT_SHARED_SECRET && e.AGENT_INTERNAL_URL && e.AGENT_PUBLIC_URL);
}

export function agentPublicWsUrl(): string {
  return process.env.AGENT_PUBLIC_URL!.replace(/^http/, "ws").replace(/\/$/, "");
}

async function call(path: string): Promise<Response> {
  return fetch(`${process.env.AGENT_INTERNAL_URL!.replace(/\/$/, "")}${path}`, {
    method: "POST", headers: { "x-agent-secret": process.env.AGENT_SHARED_SECRET! }, cache: "no-store",
  });
}

/** Opens a login window on the agent; returns its session id. */
export async function startLinkedInLogin(): Promise<string> {
  const res = await call("/internal/login");
  if (!res.ok) throw new Error(`LinkedIn agent unavailable (${res.status})`);
  return (await res.json()).sessionId;
}

export async function requestCrawl(): Promise<void> {
  await call("/internal/crawl").catch(() => {});
}

/** "<exp>.<sig>" binding a live-view WebSocket to one login session for 15 minutes. */
export function liveToken(sessionId: string, now = Date.now()): string {
  const exp = String(Math.floor(now / 1000) + 15 * 60);
  const sig = createHmac("sha256", process.env.AGENT_SHARED_SECRET!).update(`${sessionId}.${exp}`).digest("base64url");
  return `${exp}.${sig}`;
}

export function agentSecretMatches(presented: string | null): boolean {
  const secret = process.env.AGENT_SHARED_SECRET;
  if (!secret || !presented) return false;
  const a = createHash("sha256").update(secret).digest();
  const b = createHash("sha256").update(presented).digest();
  return timingSafeEqual(a, b);
}
