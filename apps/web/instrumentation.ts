// Resume mapping runs that were queued (or interrupted) before the server last restarted.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { processQueue } = await import("./lib/agent/run");
  setTimeout(() => processQueue().catch((e) => console.error("startup mapping queue", e)), 5000);
}
