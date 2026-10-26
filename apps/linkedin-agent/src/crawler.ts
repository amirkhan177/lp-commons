import { config } from "./config.js";
import * as db from "./db.js";
import { collectConnections, collectExperience, newContext, pause, type Blocked } from "./linkedin.js";

// Background crawl of the user's own network, at a human pace and capped per day. On any sign of
// LinkedIn wanting a human (login page, checkpoint, CAPTCHA) it stops and asks the user.

let running = false;

async function tellWeb(): Promise<void> {
  if (!config.webInternalUrl) return;
  await fetch(`${config.webInternalUrl}/api/internal/linkedin-updated`, {
    method: "POST", headers: { "x-agent-secret": config.sharedSecret },
  }).catch((e) => console.error("could not reach web service", e.message));
}

async function stopFor(blocked: NonNullable<Blocked>): Promise<void> {
  const detail = blocked === "challenge"
    ? "LinkedIn asked for a security check. Sign in again from Settings to continue."
    : "Your LinkedIn session ended. Sign in again from Settings to continue.";
  await db.setStatus(blocked, detail);
  await db.notifyUser("LinkedIn needs you to sign in again", detail, "/settings");
  console.log(`crawl stopped: ${blocked}`);
}

export async function crawl(): Promise<void> {
  if (running) return;
  running = true;
  let context;
  try {
    const session = await db.loadSession();
    if (!session || session.status !== "connected") return;
    context = await newContext(session.state);
    const page = await context.newPage();

    const due = !session.lastSyncedAt || Date.now() - session.lastSyncedAt.getTime() > config.connectionsRefreshHours * 3600e3;
    if (due) {
      const { connections, blocked } = await collectConnections(page);
      if (blocked) return await stopFor(blocked);
      if (connections.length) {
        await db.upsertConnections(connections);
        console.log(`connections: ${connections.length}`);
        await tellWeb();
      }
    }

    const budget = config.dailyProfileCap - (await db.profilesEnrichedToday());
    const todo = budget > 0 ? await db.profilesToVisit(budget) : [];
    let done = 0;
    for (const p of todo) {
      await pause(config.delayMinMs, config.delayMaxMs);
      const { entries, blocked } = await collectExperience(page, p.linkedin_url);
      if (blocked) return await stopFor(blocked);
      await db.saveExperience(p.id, entries);
      done++;
      if (done % 25 === 0) await tellWeb();
    }
    if (done) {
      console.log(`profiles: ${done}`);
      await tellWeb();
    }
    // Cookies rotate; keep the freshest session for next time.
    await db.saveSession(JSON.stringify(await context.storageState()));
  } catch (e) {
    console.error("crawl failed", e);
  } finally {
    await context?.close().catch(() => {});
    running = false;
  }
}
