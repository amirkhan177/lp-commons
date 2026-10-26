// Fund filters shared by Reach and the mapper search: raise status, remaining to raise, fund size.

export type RaiseStatus = "raising" | "fresh_capital";

export interface FundFilters {
  status: RaiseStatus | null;
  minRemaining: number | null; // USD still to raise
  minRaised: number | null;    // USD raised so far (fund size proxy)
}

export const STATUS_OPTIONS: { value: RaiseStatus | ""; label: string; hint?: string }[] = [
  { value: "", label: "Any status" },
  { value: "raising", label: "Currently raising", hint: "Filed in the last 18 months with room left in the offering" },
  { value: "fresh_capital", label: "Fresh capital (est.)",
    hint: "Fully raised and filed in the last 24 months — likely still deploying. Form D doesn't report dry powder directly." },
];
export const REMAINING_OPTIONS = [0, 1e6, 10e6, 50e6];
export const RAISED_OPTIONS = [0, 10e6, 50e6, 250e6];

const pick = (v: string | undefined, allowed: number[]) => {
  const n = Number(v);
  return v && allowed.includes(n) && n > 0 ? n : null;
};

export function parseFilters(p: { status?: string; remaining?: string; raised?: string }): FundFilters {
  return {
    status: p.status === "raising" || p.status === "fresh_capital" ? p.status : null,
    minRemaining: pick(p.remaining, REMAINING_OPTIONS),
    minRaised: pick(p.raised, RAISED_OPTIONS),
  };
}

export function hasFilters(f: FundFilters): boolean {
  return Boolean(f.status || f.minRemaining || f.minRaised);
}

/**
 * SQL conditions on a fund_profiles alias, appended to existing params.
 * Returns a fragment like "AND fp.raise_status = $4 AND ..." (or "").
 */
export function filterSql(f: FundFilters, alias: string, params: unknown[]): string {
  const parts: string[] = [];
  if (f.status) { params.push(f.status); parts.push(`${alias}.raise_status = $${params.length}`); }
  if (f.minRemaining) {
    params.push(f.minRemaining);
    // Open-ended offerings have no fixed remainder; they count as having room.
    parts.push(`(${alias}.offering_indefinite OR ${alias}.remaining_to_raise >= $${params.length})`);
  }
  if (f.minRaised) { params.push(f.minRaised); parts.push(`${alias}.total_amount_sold >= $${params.length}`); }
  return parts.map((p) => ` AND ${p}`).join("");
}

export const shortMoney = (n: number) => (n >= 1e9 ? `$${n / 1e9}B` : n >= 1e6 ? `$${n / 1e6}M` : `$${n.toLocaleString()}`);
