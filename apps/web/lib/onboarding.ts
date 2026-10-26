import "server-only";
import { linkedinAgentEnabled } from "./agent-link";
import { encryptionConfigured } from "./crypto";
import { db, WORKSPACE_ID } from "./db";
import { googleConfigured } from "./google/oauth";

export type StepState = "done" | "ready" | "running" | "optional" | "locked" | "unavailable";

export interface Step {
  id: string;
  title: string;
  detail: string;
  state: StepState;
  href?: string;
  action?: string;
  required: boolean;
}

export interface Onboarding {
  steps: Step[];
  progress: number;     // 0..1 over required steps
  ready: boolean;       // enough to use the app
  onboarded: boolean;
  bestFundId: number | null;
  mapping: boolean;
}

/** Derived from real data, so steps tick themselves off as things get connected. */
export async function getOnboarding(): Promise<Onboarding> {
  const pool = db();
  const r = (await pool.query<{
    onboarded: boolean; latest_filing: string | null; funds: string; linkedin: string; google_contacts: string;
    possible: string; matched: string; li_status: string | null; google_connected: boolean;
    run_status: string | null; reach: string; best: number | null;
  }>(`
    SELECT
      (SELECT onboarded_at IS NOT NULL FROM workspaces WHERE id = $1) AS onboarded,
      (SELECT max(filed_at)::text FROM formd_filings) AS latest_filing,
      (SELECT count(*) FROM entities WHERE type IN ('vc_fund', 'fof')) AS funds,
      (SELECT count(*) FROM user_contacts WHERE workspace_id = $1 AND source = 'linkedin') AS linkedin,
      (SELECT count(*) FROM user_contacts WHERE workspace_id = $1 AND source = 'google') AS google_contacts,
      (SELECT count(*) FROM user_contacts WHERE workspace_id = $1 AND match_status = 'possible') AS possible,
      (SELECT count(*) FROM user_contacts WHERE workspace_id = $1 AND match_status IN ('auto', 'confirmed')) AS matched,
      (SELECT status FROM integrations WHERE workspace_id = $1 AND provider = 'linkedin') AS li_status,
      EXISTS (SELECT 1 FROM integrations WHERE workspace_id = $1 AND provider = 'google') AS google_connected,
      (SELECT status FROM mapping_runs WHERE workspace_id = $1 ORDER BY id DESC LIMIT 1) AS run_status,
      (SELECT count(*) FROM fund_reach WHERE workspace_id = $1) AS reach,
      (SELECT entity_id FROM fund_reach WHERE workspace_id = $1 ORDER BY best_score DESC LIMIT 1) AS best`,
    [WORKSPACE_ID])).rows[0];

  const n = (v: string) => Number(v).toLocaleString();
  const hasNetwork = Number(r.linkedin) > 0 || Number(r.google_contacts) > 0;
  const mapping = r.run_status === "queued" || r.run_status === "running";
  const mapped = Number(r.reach) > 0 || (r.run_status === "done" && hasNetwork);

  const steps: Step[] = [
    {
      id: "data", title: "Fund database online", required: true,
      state: r.latest_filing ? "done" : "running",
      detail: r.latest_filing
        ? `${n(r.funds)} VC funds and funds-of-funds from SEC Form D, updated through ${r.latest_filing}.`
        : "The SEC Form D database is still loading. This step completes on its own.",
    },
    {
      id: "linkedin_csv", title: "Import your LinkedIn connections", required: false,
      state: Number(r.linkedin) > 0 ? "done" : "ready",
      detail: Number(r.linkedin) > 0
        ? `${n(r.linkedin)} connections imported.`
        : "LinkedIn → Settings → Data privacy → Get a copy of your data → Connections. LinkedIn emails the file in about 10 minutes; upload it here.",
      action: "upload",
    },
  ];
  if (linkedinAgentEnabled()) {
    steps.push({
      id: "linkedin_agent", title: "Let the agent read your work history", required: false,
      state: r.li_status === "connected" ? "done" : r.li_status ? "ready" : "optional",
      detail: r.li_status === "connected"
        ? "Signed in. The agent reads your connections' work history in the background, a few each minute."
        : r.li_status
          ? "LinkedIn asked you to sign in again. Reconnect from Settings."
          : "Optional and opt-in: past employers make many more routes. Uses your own LinkedIn session; review the risks first.",
      href: "/settings",
    });
  }
  steps.push({
    id: "google", title: "Connect Google contacts & calendar", required: false,
    state: r.google_connected ? "done" : googleConfigured() && encryptionConfigured() ? "optional" : "unavailable",
    detail: r.google_connected
      ? `${n(r.google_contacts)} contacts synced. People you've met rank higher.`
      : googleConfigured() && encryptionConfigured()
        ? "Optional: people you've actually met make the strongest intros. Read-only."
        : "Not set up on this server yet (needs a Google OAuth client).",
    href: "/settings",
  });
  steps.push({
    id: "review", title: "Review possible matches", required: false,
    state: !hasNetwork ? "locked" : Number(r.possible) > 0 ? "ready" : "done",
    detail: !hasNetwork
      ? "Available after you import a network."
      : Number(r.possible) > 0
        ? `${n(r.possible)} ${Number(r.possible) === 1 ? "person shares" : "people share"} a name with someone in the filings but couldn't be confirmed. Confirm or reject ${Number(r.possible) === 1 ? "it" : "them"}.`
        : `${n(r.matched)} of your connections are matched to people named in Form D filings.`,
    href: "/import",
  });
  steps.push({
    id: "map", title: "Build your intro map", required: true,
    state: !hasNetwork ? "locked" : mapping ? "running" : mapped ? "done" : "ready",
    detail: !hasNetwork
      ? "Starts automatically once you import a network."
      : mapping
        ? "Mapping every active fund through your network…"
        : mapped
          ? `${n(r.reach)} active funds reachable through your network.`
          : "Ready to run.",
    href: "/reach",
  });

  // A network source counts as required: at least one of the network steps must be done.
  const networkDone = hasNetwork || r.li_status === "connected";
  const required = [steps[0], steps.find((s) => s.id === "map")!];
  const doneCount = required.filter((s) => s.state === "done").length + (networkDone ? 1 : 0);
  const progress = doneCount / (required.length + 1);

  return {
    steps, progress, ready: networkDone && mapped, onboarded: r.onboarded, bestFundId: r.best, mapping,
  };
}

export async function markOnboarded(): Promise<void> {
  await db().query("UPDATE workspaces SET onboarded_at = COALESCE(onboarded_at, now()) WHERE id = $1", [WORKSPACE_ID]);
}

export async function isOnboarded(): Promise<boolean> {
  const { rows } = await db().query<{ ok: boolean }>(
    "SELECT onboarded_at IS NOT NULL AS ok FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
  return rows[0]?.ok ?? false;
}
