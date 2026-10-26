import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authConfigured, checkPassword, createSessionToken, SESSION_TTL_SECONDS } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/constants";

async function login(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  if (!checkPassword(password)) {
    await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
    redirect("/login?error=1");
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const configured = authConfigured();
  return (
    <main className="login card stack">
      <div className="hud-kicker">Secure access</div>
      <h1 style={{ margin: 0 }}>LP Commons</h1>
      {!configured ? (
        <p className="notice">
          Sign-in is disabled until <code>ADMIN_PASSWORD</code> (at least 12 characters) and{" "}
          <code>SESSION_SECRET</code> are set on the server.
        </p>
      ) : (
        <form action={login} className="stack">
          <label className="stack">
            <span>Password</span>
            <input type="password" name="password" autoComplete="current-password" required autoFocus />
          </label>
          {error && <p className="error small">Wrong password.</p>}
          <button type="submit">Sign in</button>
        </form>
      )}
    </main>
  );
}
