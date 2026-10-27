import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authConfigured, checkPassword, createSessionToken, SESSION_TTL_SECONDS } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/constants";
import { Icon } from "../ui/icons";
import { Notice } from "../ui/shell";
import { SubmitButton } from "../ui/forms";

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
    <main className="auth">
      <div className="auth-form">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <span className="logo"><Icon name="link" size={18} /></span>
            <b style={{ fontSize: 18, color: "var(--text)" }}>LP Commons</b>
          </div>
          <h1>Welcome back</h1>
          <p className="lead">Sign in to see your warm intro routes.</p>
          {!configured ? (
            <Notice>
              Sign-in is disabled until <code>ADMIN_PASSWORD</code> (at least 12 characters) and{" "}
              <code>SESSION_SECRET</code> are set on the server.
            </Notice>
          ) : (
            <form action={login} className="stack-lg">
              <label className="field">
                <span>Password</span>
                <input type="password" name="password" autoComplete="current-password" required autoFocus
                       aria-invalid={error ? true : undefined} aria-describedby={error ? "login-error" : undefined} />
                {error && <span id="login-error" className="error small">Wrong password. Try again.</span>}
              </label>
              <SubmitButton className="block" pending="Signing in…">Sign in</SubmitButton>
            </form>
          )}
          <p className="muted xs" style={{ marginTop: 28 }}>Built from public SEC Form D filings. Your network stays in this private instance.</p>
        </div>
      </div>
      <div className="auth-art" aria-hidden>
        <blockquote>
          <b>Every venture fund on Form D, and the shortest warm route to each one.</b>
          <span>Open-source LP research for emerging managers.</span>
        </blockquote>
      </div>
    </main>
  );
}
