// Minimal OpenRouter client: any model, the user's own key. https://openrouter.ai/docs

const BASE = "https://openrouter.ai/api/v1";
export const DEFAULT_MODEL = "openrouter/auto";
/** Free model tried once when the GP's chosen model can't be served (blocked providers, no endpoints, rate limits). */
export const FALLBACK_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free";

let modelCache: { at: number; ids: string[] } | null = null;

/** Model IDs currently offered by OpenRouter (public list, cached for an hour). */
export async function listModels(): Promise<string[]> {
  if (modelCache && Date.now() - modelCache.at < 3600e3) return modelCache.ids;
  try {
    const res = await fetch(`${BASE}/models`, { next: { revalidate: 3600 } });
    const body = await res.json();
    const ids: string[] = (body?.data ?? []).map((m: { id: string }) => m.id).filter(Boolean).sort();
    modelCache = { at: Date.now(), ids: [DEFAULT_MODEL, ...ids.filter((i) => i !== DEFAULT_MODEL)] };
  } catch {
    modelCache = { at: Date.now(), ids: [DEFAULT_MODEL] };
  }
  return modelCache.ids;
}

const headers = (key: string) => ({
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  "HTTP-Referer": process.env.APP_URL ?? "https://github.com/amirkhan177/lp-commons",
  "X-Title": "LP Commons",
});

export function maskKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : "…";
}

/** Checks the key with OpenRouter; returns its spending limit info. */
export async function checkKey(key: string): Promise<{ ok: boolean; limit: number | null; usage: number | null; error?: string }> {
  if (!/^sk-or-[\w-]{10,}$/.test(key.trim())) return { ok: false, limit: null, usage: null, error: "That doesn't look like an OpenRouter key (sk-or-…)." };
  try {
    const res = await fetch(`${BASE}/key`, { headers: headers(key.trim()), cache: "no-store" });
    if (res.status === 401 || res.status === 403) return { ok: false, limit: null, usage: null, error: "OpenRouter rejected that key." };
    if (!res.ok) return { ok: false, limit: null, usage: null, error: `OpenRouter returned ${res.status}.` };
    const body = await res.json();
    return { ok: true, limit: body?.data?.limit ?? null, usage: body?.data?.usage ?? null };
  } catch {
    return { ok: false, limit: null, usage: null, error: "Couldn't reach OpenRouter." };
  }
}

/** OpenRouter's own error message from a failed response body, if it has one. */
export function errorDetail(body: string): string {
  try {
    const msg = JSON.parse(body)?.error?.message;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
  } catch { /* not JSON */ }
  return body.trim();
}

/** True when the request failed because this model can't be served right now, so another model may work. */
export function modelUnavailable(status: number, detail: string): boolean {
  return [404, 429, 502, 503].includes(status) || /no (allowed )?(providers|endpoints)|not a valid model|model .*not (found|available)/i.test(detail);
}

export function friendlyError(status: number, detail: string): string {
  if (status === 401 || status === 403) return "OpenRouter rejected the key. Check it under openrouter.ai/keys.";
  if (status === 402) return "OpenRouter: out of credits on this key.";
  if (/no allowed providers/i.test(detail)) {
    return "OpenRouter blocked every provider for this model. Check Allowed/Ignored providers and data policy under openrouter.ai/settings/privacy, or the key's guardrails.";
  }
  if (status === 429) return "OpenRouter rate limit reached. Try again in a minute.";
  return `OpenRouter ${status}: ${detail.slice(0, 160)}`;
}

const CHAT_TIMEOUT_MS = 120_000;

async function chatOnce(key: string, model: string, system: string, user: string, maxTokens: number) {
  // The fallback is a reasoning model: keep its thinking short and out of the answer, and leave room for it.
  const reasoning = model === FALLBACK_MODEL ? { reasoning: { effort: "low", exclude: true } } : {};
  let res: Response;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: model === FALLBACK_MODEL ? maxTokens + 4000 : maxTokens,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        ...reasoning,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    return { ok: false as const, status: 0, detail: timedOut ? `${model} didn't answer within ${CHAT_TIMEOUT_MS / 1000}s.` : "Couldn't reach OpenRouter." };
  }
  if (!res.ok) {
    const detail = errorDetail(await res.text().catch(() => ""));
    return { ok: false as const, status: res.status, detail };
  }
  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) return { ok: false as const, status: 0, detail: "The model returned an empty answer." };
  return { ok: true as const, text: content };
}

/** Chat with the GP's model; if it can't be served, retry once on the free fallback model. */
export async function chat(key: string, model: string, system: string, user: string, maxTokens = 1500):
  Promise<{ text: string; model: string }> {
  const chosen = model || DEFAULT_MODEL;
  const first = await chatOnce(key, chosen, system, user, maxTokens);
  if (first.ok) return { text: first.text, model: chosen };
  if (chosen !== FALLBACK_MODEL && (first.status === 0 || modelUnavailable(first.status, first.detail))) {
    const second = await chatOnce(key, FALLBACK_MODEL, system, user, maxTokens);
    if (second.ok) return { text: second.text, model: FALLBACK_MODEL };
    throw new Error(`${friendlyError(first.status, first.detail)} The free fallback (${FALLBACK_MODEL}) also failed: ${friendlyError(second.status, second.detail)}`);
  }
  throw new Error(first.status === 0 ? first.detail : friendlyError(first.status, first.detail));
}

/** First JSON object/array in a model's answer (tolerates ```json fences and chatter). */
export function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.search(/[{[]/);
  if (start < 0) throw new Error("No JSON in the model's answer.");
  const open = fenced[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < fenced.length; i++) {
    const ch = fenced[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(fenced.slice(start, i + 1));
  }
  throw new Error("Incomplete JSON in the model's answer.");
}
