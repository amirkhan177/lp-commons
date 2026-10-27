// Turning a fund's website and deck into plain text for drafting a profile.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function htmlToText(html: string): { title: string; description: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const description = (html.match(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? "").trim();
  const text = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|h[1-6]|li|section|article|br|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) || " " : m))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  const decode = (s: string) => s.replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? m);
  return { title: decode(title), description: decode(description), text };
}

/** Same-site pages likely to describe the thesis, at most `limit`. */
export function relevantLinks(html: string, base: string, limit = 3): string[] {
  const origin = new URL(base).origin;
  const out: string[] = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    let u: URL;
    try { u = new URL(m[1], base); } catch { continue; }
    if (u.origin !== origin || u.pathname === "/" ) continue;
    if (!/(about|thesis|focus|strategy|approach|invest|team|portfolio|who-we-are|what-we-do)/i.test(u.pathname)) continue;
    const s = u.origin + u.pathname;
    if (!out.includes(s)) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/** Text of a PDF deck (first 30 pages). */
export async function pdfToText(data: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text.slice(0, 30).join("\n") : String(text)).replace(/\s+\n/g, "\n").trim();
}
