import { after, NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { enqueueMapping } from "@/lib/agent/run";
import { encrypt } from "@/lib/crypto";
import { db, WORKSPACE_ID } from "@/lib/db";
import { exchangeCode, GOOGLE_SCOPES, OAUTH_COOKIE } from "@/lib/google/oauth";
import { syncGoogle } from "@/lib/google/sync";
import { requireSession } from "@/lib/session";

function back(req: NextRequest, query: string) {
  const res = NextResponse.redirect(new URL(`/settings?${query}`, process.env.APP_URL ?? req.url));
  res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/google" });
  return res;
}

export async function GET(req: NextRequest) {
  await requireSession();
  const params = req.nextUrl.searchParams;
  const [state, verifier] = (req.cookies.get(OAUTH_COOKIE)?.value ?? "").split(".");
  const got = params.get("state") ?? "";
  if (!state || !verifier || got.length !== state.length || !timingSafeEqual(Buffer.from(got), Buffer.from(state))) {
    return back(req, "error=google_state");
  }
  if (params.get("error")) return back(req, "error=google_denied");
  const code = params.get("code");
  if (!code) return back(req, "error=google_denied");

  let tokens;
  try {
    tokens = await exchangeCode(code, verifier);
  } catch {
    return back(req, "error=google_token");
  }
  const granted = new Set(tokens.scope.split(" "));
  if (!tokens.refresh_token || !GOOGLE_SCOPES.every((s) => granted.has(s))) return back(req, "error=google_scopes");

  await db().query(
    `INSERT INTO integrations (workspace_id, provider, refresh_token, scopes)
     VALUES ($1, 'google', $2, $3)
     ON CONFLICT (workspace_id, provider) DO UPDATE SET refresh_token = EXCLUDED.refresh_token,
       scopes = EXCLUDED.scopes`,
    [WORKSPACE_ID, encrypt(tokens.refresh_token), tokens.scope],
  );
  after(async () => {
    try {
      await syncGoogle();
      await enqueueMapping("google_sync");
    } catch (e) {
      console.error("google sync failed", e);
    }
  });
  return back(req, "ok=google_connected");
}
