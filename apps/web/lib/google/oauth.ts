import { createHash, randomBytes } from "node:crypto";

// Read-only scopes: your contacts, people you've emailed ("other contacts"), and calendar events.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];

export const OAUTH_COOKIE = "lpc_google_oauth";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_URL);
}

export function redirectUri(): string {
  return new URL("/api/google/callback", process.env.APP_URL).toString();
}

/** state + PKCE verifier, kept in a short-lived httpOnly cookie between start and callback. */
export function newAuthRequest(): { state: string; verifier: string; url: string } {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { state, verifier, url: url.toString() };
}

interface TokenResponse { access_token: string; refresh_token?: string; scope: string; expires_in: number }

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...params,
    }),
  });
  if (!res.ok) throw new Error(`Google token request failed (${res.status})`);
  return res.json();
}

export function exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
  return tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri() });
}

export async function accessToken(refreshToken: string): Promise<string> {
  return (await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken })).access_token;
}

export async function revoke(token: string): Promise<void> {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => {});
}
