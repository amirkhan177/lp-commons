import { randomUUID } from "node:crypto";
import type { BrowserContext, CDPSession, Page } from "playwright";
import type { WebSocket } from "ws";
import { config } from "./config.js";
import { saveSession } from "./db.js";
import { blockedState, linkedinUrl, newContext, SESSION_COOKIE, VIEWPORT } from "./linkedin.js";

// A remote login window: the user signs in to LinkedIn themselves (password, 2FA) in a browser
// running here, seen through a CDP screencast. Their keystrokes are forwarded to the page and
// never logged or stored; only the resulting session (cookies) is saved, encrypted.

type ClientMsg =
  | { t: "click"; x: number; y: number }
  | { t: "key"; key: string }
  | { t: "text"; text: string }
  | { t: "wheel"; dy: number };

const SPECIAL_KEYS = new Set(["Enter", "Backspace", "Tab", "Escape", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

export class LiveSession {
  readonly id = randomUUID();
  private context!: BrowserContext;
  private page!: Page;
  private cdp!: CDPSession;
  private client: WebSocket | null = null;
  private lastFrame: string | null = null; // replayed to a viewer that connects after the page went idle
  private poll?: NodeJS.Timeout;
  private timeout?: NodeJS.Timeout;
  closed = false;

  constructor(private onLoggedIn: () => void, private onClose: (s: LiveSession) => void) {}

  async start(): Promise<void> {
    this.context = await newContext();
    this.page = await this.context.newPage();
    await this.page.goto(linkedinUrl("/login"), { waitUntil: "domcontentloaded" });
    this.cdp = await this.context.newCDPSession(this.page);
    this.cdp.on("Page.screencastFrame", (f) => {
      this.lastFrame = f.data;
      this.send({ t: "frame", data: f.data });
      this.cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height });
    this.poll = setInterval(() => this.checkLoggedIn().catch(() => {}), 1000);
    this.timeout = setTimeout(() => this.close("Login window timed out. Start again from Settings."), config.loginTimeoutMs);
  }

  attach(ws: WebSocket): void {
    this.client?.close();
    this.client = ws;
    this.send({ t: "hello", width: VIEWPORT.width, height: VIEWPORT.height });
    if (this.lastFrame) this.send({ t: "frame", data: this.lastFrame });
    ws.on("message", (raw) => {
      let msg: ClientMsg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      this.input(msg).catch(() => {});
    });
    ws.on("close", () => { if (this.client === ws) this.client = null; });
  }

  private async input(m: ClientMsg): Promise<void> {
    if (this.closed) return;
    if (m.t === "click" && Number.isFinite(m.x) && Number.isFinite(m.y)) {
      await this.page.mouse.click(Math.round(m.x), Math.round(m.y));
    } else if (m.t === "key" && typeof m.key === "string") {
      if (SPECIAL_KEYS.has(m.key)) await this.page.keyboard.press(m.key);
      else if ([...m.key].length === 1) await this.page.keyboard.insertText(m.key);
    } else if (m.t === "text" && typeof m.text === "string" && m.text.length <= 512) {
      await this.page.keyboard.insertText(m.text);
    } else if (m.t === "wheel" && Number.isFinite(m.dy)) {
      await this.page.mouse.wheel(0, Math.max(-2000, Math.min(2000, m.dy)));
    }
  }

  private async checkLoggedIn(): Promise<void> {
    if (this.closed) return;
    const cookies = await this.context.cookies();
    const hasSession = cookies.some((c) => c.name === SESSION_COOKIE && c.value);
    if (!hasSession || (await blockedState(this.page))) return;
    await saveSession(JSON.stringify(await this.context.storageState()));
    this.send({ t: "done" });
    await this.close(null);
    this.onLoggedIn();
  }

  private send(msg: object): void {
    if (this.client?.readyState === 1) this.client.send(JSON.stringify(msg));
  }

  async close(error: string | null): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.poll);
    clearTimeout(this.timeout);
    if (error) this.send({ t: "error", message: error });
    this.client?.close();
    await this.context?.close().catch(() => {});
    this.onClose(this);
  }
}
