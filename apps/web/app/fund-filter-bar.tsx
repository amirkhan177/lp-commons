import Link from "next/link";
import { RAISED_OPTIONS, REMAINING_OPTIONS, STATUS_OPTIONS, shortMoney, type FundFilters } from "@/lib/fund-filters";

/** GET form; works without JavaScript. `keep` carries other query params (e.g. the search text). */
export default function FundFilterBar({ action, filters, keep = {}, extra }: {
  action: string; filters: FundFilters; keep?: Record<string, string | undefined>; extra?: React.ReactNode;
}) {
  const hint = STATUS_OPTIONS.find((o) => o.value === (filters.status ?? ""))?.hint;
  return (
    <form method="get" action={action} className="filter-bar">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label>
        <span>Status</span>
        <select name="status" defaultValue={filters.status ?? ""}>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label>
        <span>Left to raise</span>
        <select name="remaining" defaultValue={String(filters.minRemaining ?? 0)}>
          {REMAINING_OPTIONS.map((n) => <option key={n} value={n}>{n ? `≥ ${shortMoney(n)}` : "Any"}</option>)}
        </select>
      </label>
      <label>
        <span>Raised so far</span>
        <select name="raised" defaultValue={String(filters.minRaised ?? 0)}>
          {RAISED_OPTIONS.map((n) => <option key={n} value={n}>{n ? `≥ ${shortMoney(n)}` : "Any"}</option>)}
        </select>
      </label>
      {extra}
      <div className="filter-actions">
        <button type="submit">Apply</button>
        <Link href={`${action}${keep.q ? `?q=${encodeURIComponent(keep.q)}` : ""}`} className="small">Clear</Link>
      </div>
      {hint && <p className="filter-hint">{hint}</p>}
    </form>
  );
}

export function RaiseBadge({ status, remaining, indefinite }: { status: string | null; remaining: string | null; indefinite: boolean | null }) {
  if (status === "raising") {
    const left = indefinite ? "open-ended" : remaining != null && Number(remaining) > 0 ? `${shortMoney(Math.round(Number(remaining) / 1e5) * 1e5)} left` : null;
    return <span className="badge ok">Raising{left ? ` · ${left}` : ""}</span>;
  }
  if (status === "fresh_capital") return <span className="badge" title="Fully raised in the last 24 months — estimated, not reported">Fresh capital (est.)</span>;
  return null;
}
