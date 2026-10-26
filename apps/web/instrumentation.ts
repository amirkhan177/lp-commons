// Background work in the web process: resume queued mapping runs from before a restart, and
// start the hourly scheduler (weekly re-map, Google sync, digest; freshness checks).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { processQueue } = await import("./lib/agent/run");
  setTimeout(() => processQueue().catch((e) => console.error("startup mapping queue", e)), 5000);
  const { startScheduler } = await import("./lib/jobs");
  startScheduler();
}
