// Minimal OpenRouter client: any model, the user's own key. https://openrouter.ai/docs

const BASE = "https://openrouter.ai/api/v1";
export const DEFAULT_MODEL = "openrouter/auto";

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

export async function chat(key: string, model: string, system: string, user: string, maxTokens = 1500): Promise<string> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}${res.status === 402 ? " (out of credits)" : ""}: ${detail.slice(0, 200)}`);
  }
  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("The model returned an empty answer.");
  return content;
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
