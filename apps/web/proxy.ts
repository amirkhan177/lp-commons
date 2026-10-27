import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/constants";

// Optimistic gate only: sends visitors without a session cookie to /login.
// Every page and server action still verifies the signed session itself (lib/session.ts).
export function proxy(request: NextRequest) {
  if (!request.cookies.get(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Icons and the web manifest are public so the sign-in page and home-screen installs can load them.
  matcher: ["/((?!login|api/internal|_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest).*)"],
};
