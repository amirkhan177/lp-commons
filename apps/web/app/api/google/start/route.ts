import { NextResponse } from "next/server";
import { encryptionConfigured } from "@/lib/crypto";
import { googleConfigured, newAuthRequest, OAUTH_COOKIE } from "@/lib/google/oauth";
import { requireSession } from "@/lib/session";

export async function GET() {
  await requireSession();
  if (!googleConfigured() || !encryptionConfigured()) {
    return NextResponse.redirect(new URL("/settings?error=google_not_configured", process.env.APP_URL ?? "http://localhost:3000"));
  }
  const { state, verifier, url } = newAuthRequest();
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, `${state}.${verifier}`, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/google", maxAge: 600,
  });
  return res;
}
