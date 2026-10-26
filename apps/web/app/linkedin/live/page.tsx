import Link from "next/link";
import Nav from "../../nav";
import LiveLogin from "./live-login";
import { agentPublicWsUrl, linkedinAgentEnabled, liveToken } from "@/lib/agent-link";
import { requireSession } from "@/lib/session";

export default async function LinkedInLivePage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  await requireSession();
  const { s } = await searchParams;
  if (!linkedinAgentEnabled() || !s || !/^[0-9a-f-]{36}$/.test(s)) {
    return <div className="shell"><Nav /><p>No login window open. <Link href="/settings">Back to Settings</Link></p></div>;
  }
  const wsUrl = `${agentPublicWsUrl()}/live?s=${s}&t=${encodeURIComponent(liveToken(s))}`;
  return (
    <div className="shell">
      <Nav />
      <h1>Sign in to LinkedIn</h1>
      <p className="muted small">
        This window is a browser running on your LP Commons server. Sign in as you normally would, including any
        verification code. Your password goes straight to LinkedIn and is never stored; only the resulting session is
        saved, encrypted. Click the window first, then type. Social sign-in pop-ups (Google/Apple) aren&apos;t
        supported here — use your email and password.
      </p>
      <LiveLogin wsUrl={wsUrl} />
    </div>
  );
}
