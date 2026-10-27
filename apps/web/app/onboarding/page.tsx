import Link from "next/link";
import { redirect } from "next/navigation";
import Shell, { Flash } from "../ui/shell";
import { Icon } from "../ui/icons";
import { uploadConnections } from "../import/actions";
import AutoRefresh from "./auto-refresh";
import { getOnboarding, markOnboarded, type StepState } from "@/lib/onboarding";
import { requireSession } from "@/lib/session";

const CHIP_CLASS: Record<StepState, string> = {
  done: "ok", ready: "", running: "warn", optional: "violet", locked: "neutral", unavailable: "neutral",
};
const CHIP: Record<StepState, string> = {
  done: "Done", ready: "To do", running: "In progress", optional: "Optional", locked: "Waiting", unavailable: "Not available",
};

async function finish(formData: FormData) {
  "use server";
  await requireSession();
  await markOnboarded();
  const to = String(formData.get("to") ?? "/reach");
  redirect(/^\/(reach|map\?target=\d+)$/.test(to) ? to : "/reach");
}

function Ring({ value }: { value: number }) {
  const r = 42, c = 2 * Math.PI * r;
  return (
    <div className="ring" role="img" aria-label={`Setup ${Math.round(value * 100)}% complete`}>
      <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden>
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--primary)" strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${c * value} ${c}`} />
      </svg>
      <div className="pct"><div>{Math.round(value * 100)}%<small>ready</small></div></div>
    </div>
  );
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireSession();
  const { ok, error } = await searchParams;
  const ob = await getOnboarding();
  const dest = ob.bestFundId ? `/map?target=${ob.bestFundId}` : "/reach";

  return (
    <Shell>
      <AutoRefresh active={ob.mapping || ob.steps[0].state === "running"} />
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="ob-hero">
          <Ring value={ob.progress} />
          <div>
            <h1>Get ready to raise</h1>
            <p className="muted" style={{ marginTop: 6, maxWidth: 640 }}>
              Connect your network once. LP Commons matches it against every venture fund and fund of funds that has
              filed a Form D, then keeps your intro map up to date in the background. Steps tick off on their own.
            </p>
          </div>
        </div>
      </div>
      <Flash ok={ok} error={error} />

      <div className="card flush">
        <ol className="steps">
          {ob.steps.map((s, i) => (
            <li key={s.id} className={`step ${s.state}`} aria-label={`Step ${i + 1}: ${s.title}, ${CHIP[s.state]}`}>
              <div className="step-num">{s.state === "done" ? <Icon name="check" size={18} /> : i + 1}</div>
              <div>
                <h3>{s.title} <span className={`badge ${CHIP_CLASS[s.state]}`}>{CHIP[s.state]}</span></h3>
                <p>{s.detail}</p>
                {s.id === "linkedin" && s.href && (
                  <div className="act"><Link className="btn" href={s.href}><Icon name="linkedin" size={16} />Connect LinkedIn</Link></div>
                )}
                {s.action === "upload" && (s.state !== "done" || ob.agent) && (
                  <details className="act-alt" open={!ob.agent && s.state !== "done"}>
                    {ob.agent && <summary>{s.state === "done" ? "Upload a newer export" : "Or upload your LinkedIn export instead"}</summary>}
                    <form action={uploadConnections} className="act">
                      <input type="hidden" name="returnTo" value="/onboarding" />
                      <input type="file" name="file" accept=".csv,text/csv" required aria-label="LinkedIn Connections.csv" />
                      <button className="secondary" type="submit"><Icon name="upload" size={16} />Upload</button>
                    </form>
                  </details>
                )}
                {s.href && s.id !== "linkedin" && s.state !== "locked" && s.state !== "unavailable" && s.state !== "done" && (
                  <div className="act"><Link className="btn secondary" href={s.href}>Open <Icon name="arrow" size={16} /></Link></div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="row" style={{ marginTop: 20 }}>
        <form action={finish}>
          <input type="hidden" name="to" value={dest} />
          <button type="submit" disabled={!ob.ready}>
            {ob.ready ? (ob.bestFundId ? "Open my best route" : "Go to my map") : "Finish the steps above"}
          </button>
        </form>
        <form action={finish}>
          <input type="hidden" name="to" value="/reach" />
          <button className="ghost" type="submit">{ob.onboarded ? "Close setup" : "Skip for now"}</button>
        </form>
      </div>
      <p className="footnote">
        Your imported network stays private to this instance. Paths are based on public filings and automated matching;
        verify before reaching out. Not investment advice.
      </p>
    </Shell>
  );
}
