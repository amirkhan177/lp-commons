import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken } from "./auth";
import { SESSION_COOKIE } from "./constants";

/** Call at the top of every page, server action, and route handler that touches private data. */
export async function requireSession(): Promise<void> {
  const jar = await cookies();
  if (!verifySessionToken(jar.get(SESSION_COOKIE)?.value)) redirect("/login");
}
