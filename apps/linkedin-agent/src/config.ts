function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const num = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

export const config = {
  port: num("PORT", 8080),
  databaseUrl: required("DATABASE_URL"),
  // Shared with the web service: signs live-view tokens and authenticates internal calls.
  sharedSecret: required("AGENT_SHARED_SECRET"),
  webInternalUrl: process.env.WEB_INTERNAL_URL ?? "", // e.g. http://web.railway.internal:8080
  // Overridable so the flow can be exercised against tests/fake-linkedin instead of LinkedIn.
  baseUrl: (process.env.LINKEDIN_BASE_URL ?? "https://www.linkedin.com").replace(/\/$/, ""),
  // Pace: deliberately slow and capped. These are guardrails, not tuning knobs to max out.
  dailyProfileCap: Math.min(num("LINKEDIN_DAILY_PROFILE_CAP", 120), 200),
  delayMinMs: Math.max(num("LINKEDIN_DELAY_MIN_S", 20), 10) * 1000,
  delayMaxMs: Math.max(num("LINKEDIN_DELAY_MAX_S", 50), 15) * 1000,
  connectionsRefreshHours: 24,
  loginTimeoutMs: 10 * 60 * 1000,
  tickMs: 10 * 60 * 1000,
};

export const WORKSPACE_ID = 1;
