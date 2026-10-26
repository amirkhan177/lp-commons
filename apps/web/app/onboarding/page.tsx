import Link from "next/link";
import { redirect } from "next/navigation";
import HudShell from "../hud-shell";
import Nav from "../nav";
import { uploadConnections } from "../import/actions";
import AutoRefresh from "./auto-refresh";
import { getOnboarding, markOnboarded, type StepState } from "@/lib/onboarding";
import { requireSession } from "@/lib/session";

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
  const r = 48, c = 2 * Math.PI * r;
  return (
    <div className="ob-ring" role="img" aria-label={`Setup ${Math.round(value * 100)}% complete`}>
      <svg width="112" height="112" viewBox="0 0 112 112" aria-hidden>
        <circle cx="56" cy="56" r={r} fill="none" stroke="rgba(0,229,255,0.12)" strokeWidth="6" />
        <circle cx="56" cy="56" r={r} fill="none" stroke="#00e5ff" strokeWidth="6" strokeLinecap="butt"
                strokeDasharray={`${c * value} ${c}`} style={{ filter: "drop-shadow(0 0 6px #00e5ff)" }} />
        <circle cx="56" cy="56" r="38" fill="none" stroke="rgba(0,229,255,0.18)" strokeDasharray="2 6" />
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
    <HudShell>
      <div className="shell">
        <Nav />
        <AutoRefresh active={ob.mapping || ob.steps[0].state === "running"} />
        <div className="ob-head">
          <Ring value={ob.progress} />
          <div>
            <div className="hud-kicker">LP Commons // Setup</div>
            <h1>Get ready to raise</h1>
            <p className="muted" style={{ margin: 0, maxWidth: 640 }}>
              Connect your network once. LP Commons matches it against every venture fund and fund-of-funds that has
              filed a Form D, then keeps your intro map up to date in the background. Steps tick off on their own.
            </p>
          </div>
        </div>

        {ok && <p className="notice" style={{ borderLeftColor: "var(--hud-green)" }}>{ok}</p>}
        {error && <p className="notice" style={{ borderLeftColor: "var(--hud-target)" }}>{error}</p>}

        <div className="ob-steps">
          {ob.steps.map((s, i) => (
            <section key={s.id} className={`ob-step ${s.state}`} aria-label={`Step ${i + 1}: ${s.title}, ${CHIP[s.state]}`}>
              <div className="idx">{String(i + 1).padStart(2, "0")}</div>
              <div>
                <h3>{s.title} <span className={`chip ${s.state}`}>{CHIP[s.state]}</span></h3>
                <p>{s.detail}</p>
                {s.action === "upload" && s.state !== "done" && (
                  <form action={uploadConnections} className="act">
                    <input type="hidden" name="returnTo" value="/onboarding" />
                    <input className="hud-file" type="file" name="file" accept=".csv,text/csv" required aria-label="LinkedIn Connections.csv" />
                    <button className="hud-btn" type="submit">Upload</button>
                  </form>
                )}
                {s.action === "upload" && s.state === "done" && (
                  <div className="act"><Link className="hud-btn ghost" href="/import">Manage</Link></div>
                )}
                {s.href && s.state !== "locked" && s.state !== "unavailable" && s.state !== "done" && (
                  <div className="act"><Link className="hud-btn ghost" href={s.href}>Open</Link></div>
                )}
              </div>
            </section>
          ))}
        </div>

        <div className="ob-foot">
          <form action={finish}>
            <input type="hidden" name="to" value={dest} />
            <button className="hud-btn" type="submit" disabled={!ob.ready}>
              {ob.ready ? (ob.bestFundId ? "Open my best route" : "Go to my map") : "Finish the steps above"}
            </button>
          </form>
          <form action={finish}>
            <input type="hidden" name="to" value="/reach" />
            <button className="hud-btn ghost" type="submit">{ob.onboarded ? "Close setup" : "Skip for now"}</button>
          </form>
        </div>
        <p className="muted small" style={{ marginTop: 18 }}>
          Your imported network stays private to this instance. Paths are based on public filings and automated matching;
          verify before reaching out. Not investment advice.
        </p>
      </div>
    </HudShell>
  );
}
