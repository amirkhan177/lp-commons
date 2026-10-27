// Shared vocabulary for fund profiles and fit scoring, plus keyword detection (the no-LLM path).

export const SECTORS = [
  { id: "ai", label: "AI & ML", re: /\b(ai|a\.i\.|artificial intelligence|machine learning|ml|llms?|gen ?ai|generative)\b/gi },
  { id: "enterprise", label: "Enterprise & SaaS", re: /\b(enterprise|b2b|saas|software|devtools|developer tools?|infrastructure|cloud|data infrastructure)\b/gi },
  { id: "fintech", label: "Fintech", re: /\b(fintech|payments?|banking|insurtech|lending|financial services|wealthtech)\b/gi },
  { id: "health", label: "Health & bio", re: /\b(health ?care|health|medtech|digital health|biotech|bio|life sciences?|therapeutics|pharma|medical)\b/gi },
  { id: "climate", label: "Climate & energy", re: /\b(climate|carbon|energy|clean ?tech|sustainab\w*|decarboni\w*|renewables?|green)\b/gi },
  { id: "consumer", label: "Consumer", re: /\b(consumer|retail|e-?commerce|commerce|brands?|marketplaces?|d2c|dtc)\b/gi },
  { id: "deeptech", label: "Deep tech & hardware", re: /\b(deep ?tech|robotics|hardware|semiconductors?|space|quantum|frontier tech)\b/gi },
  { id: "crypto", label: "Crypto & web3", re: /\b(crypto|web ?3|blockchain|defi|digital assets?)\b/gi },
  { id: "security", label: "Cybersecurity", re: /\b(cyber ?security|security)\b/gi },
  { id: "mobility", label: "Mobility & logistics", re: /\b(mobility|transportation|logistics|automotive|supply chain)\b/gi },
  { id: "edtech", label: "Education", re: /\b(edtech|education|learning)\b/gi },
  { id: "proptech", label: "Real estate & construction", re: /\b(proptech|real estate|construction)\b/gi },
  { id: "food", label: "Food & agriculture", re: /\b(food ?tech|food|agtech|agri\w*)\b/gi },
  { id: "media", label: "Media & gaming", re: /\b(gaming|games|media|entertainment|creators?)\b/gi },
  { id: "defense", label: "Defense & gov", re: /\b(defen[cs]e|govtech|national security|dual[- ]use)\b/gi },
] as const;

export const STAGES = [
  { id: "pre_seed", label: "Pre-seed", re: /\bpre-?seed\b/gi },
  { id: "seed", label: "Seed", re: /\b(seed)\b/gi },
  { id: "series_a", label: "Series A", re: /\bseries ?a\b|\bearly[- ]stage\b/gi },
  { id: "growth", label: "Growth", re: /\b(growth|series ?[b-d]|late[- ]stage)\b/gi },
] as const;

export const GEOGRAPHIES = [
  { id: "us", label: "United States", re: /\b(united states|u\.s\.|usa|us-based|american|north america)\b/gi },
  { id: "europe", label: "Europe", re: /\b(europe\w*|european union|eu|uk|united kingdom|germany|france|nordics?)\b/gi },
  { id: "latam", label: "Latin America", re: /\b(latin america|latam|brazil|mexico|colombia)\b/gi },
  { id: "africa", label: "Africa", re: /\b(africa\w*|nigeria|kenya|egypt)\b/gi },
  { id: "india", label: "India", re: /\b(india\w*)\b/gi },
  { id: "asia", label: "Asia", re: /\b(asia\w*|southeast asia|singapore|japan|korea|china)\b/gi },
  { id: "mena", label: "Middle East", re: /\b(middle east|mena|israel\w*|gcc|uae)\b/gi },
  { id: "canada", label: "Canada", re: /\b(canad\w*)\b/gi },
] as const;

export const LP_TYPES = [
  { id: "fof", label: "Funds of funds" },
  { id: "family_office", label: "Family offices" },
  { id: "endowment", label: "Endowments & foundations" },
  { id: "pension", label: "Pensions" },
  { id: "hnw", label: "Angels & HNW individuals" },
  { id: "corporate", label: "Corporates / CVCs" },
] as const;

export const sectorIds = SECTORS.map((s) => s.id as string);
export const stageIds = STAGES.map((s) => s.id as string);
export const geoIds = GEOGRAPHIES.map((s) => s.id as string);
export const lpTypeIds = LP_TYPES.map((s) => s.id as string);
export const labelOf = (list: readonly { id: string; label: string }[], id: string) => list.find((x) => x.id === id)?.label ?? id;

function counts(list: readonly { id: string; re: RegExp }[], text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of list) {
    const n = (text.match(x.re) ?? []).length;
    if (n) m.set(x.id, n);
  }
  return m;
}

/** Sectors named in a short text (e.g. a fund name), for scoring. */
export function sectorsIn(text: string): string[] {
  return [...counts(SECTORS, text).keys()];
}

export const parseMoney = (s: string) => {
  const m = s.replace(/,/g, "").match(/\$?\s*([\d.]+)\s*(k|m|mm|million|b|bn|billion)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  return n * (unit.startsWith("b") ? 1e9 : unit.startsWith("m") ? 1e6 : unit === "k" ? 1e3 : 1);
};

export interface FundProfileDraft {
  fund_name: string | null;
  summary: string | null;
  sectors: string[];
  stages: string[];
  geographies: string[];
  fund_number: number | null;
  target_size: number | null;
  check_min: number | null;
  check_max: number | null;
  lp_types: string[];
  keywords: string[];
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };

/** Keyword-only draft from website/deck text: rough, but works without any API key. */
export function keywordDraft(title: string, text: string): FundProfileDraft {
  const all = `${title}\n${text}`;
  const top = (m: Map<string, number>, min: number, max: number) =>
    [...m.entries()].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k);
  const fundNo = all.match(/\bfund\s+(i{1,3}|iv|v|vi|[1-6])\b/i)?.[1]?.toLowerCase();
  const size = all.match(/\$\s?[\d.,]+\s?(m|mm|million|b|bn|billion)\b[^.\n]{0,20}\bfund\b/i)?.[0];
  const check = all.match(/\$\s?[\d.,]+\s?(k|m|mm|million)?\s?(?:-|–|to)\s?\$?\s?[\d.,]+\s?(k|m|mm|million)\b/i)?.[0];
  const [cmin, cmax] = check ? check.split(/-|–|to/).map((p) => parseMoney(p.includes("$") ? p : `$${p}`)) : [null, null];
  const name = title.split(/[|–—-]/)[0].trim() || null;
  return {
    fund_name: name,
    summary: null,
    sectors: top(counts(SECTORS, all), 2, 4),
    stages: top(counts(STAGES, all), 1, 2),
    geographies: top(counts(GEOGRAPHIES, all), 2, 3),
    fund_number: fundNo ? ROMAN[fundNo] ?? Number(fundNo) : null,
    target_size: size ? parseMoney(size) : null,
    check_min: cmin ?? null,
    check_max: cmax ?? null,
    lp_types: ["fof", "family_office", "hnw"],
    keywords: [],
  };
}

/** Keep only known values and sane numbers, whatever a model returned. */
export function cleanDraft(raw: Partial<Record<keyof FundProfileDraft, unknown>>): FundProfileDraft {
  const ids = (v: unknown, allowed: string[], max: number) =>
    Array.isArray(v) ? [...new Set(v.map(String).filter((x) => allowed.includes(x)))].slice(0, max) : [];
  const num = (v: unknown, lo: number, hi: number) => {
    const n = typeof v === "string" ? parseMoney(v) : typeof v === "number" ? v : null;
    return n != null && Number.isFinite(n) && n >= lo && n <= hi ? n : null;
  };
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  return {
    fund_name: str(raw.fund_name, 120),
    summary: str(raw.summary, 1200),
    sectors: ids(raw.sectors, sectorIds, 5),
    stages: ids(raw.stages, stageIds, 3),
    geographies: ids(raw.geographies, geoIds, 4),
    fund_number: num(raw.fund_number, 1, 20),
    target_size: num(raw.target_size, 1e5, 5e10),
    check_min: num(raw.check_min, 1e3, 5e9),
    check_max: num(raw.check_max, 1e3, 5e9),
    lp_types: ids(raw.lp_types, lpTypeIds, 6),
    keywords: Array.isArray(raw.keywords) ? raw.keywords.map(String).map((k) => k.trim().slice(0, 40)).filter(Boolean).slice(0, 12) : [],
  };
}
