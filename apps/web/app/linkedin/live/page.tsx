import Link from "next/link";
import Shell, { PageHead } from "../../ui/shell";
import LiveLogin from "./live-login";
import { agentPublicWsUrl, linkedinAgentEnabled, liveToken } from "@/lib/agent-link";
import { requireSession } from "@/lib/session";

export default async function LinkedInLivePage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  await requireSession();
  const { s } = await searchParams;
  if (!linkedinAgentEnabled() || !s || !/^[0-9a-f-]{36}$/.test(s)) {
    return <Shell><PageHead title="Sign in to LinkedIn" sub={<>No login window is open. <Link href="/settings">Back to Settings</Link></>} /></Shell>;
  }
  const wsUrl = `${agentPublicWsUrl()}/live?s=${s}&t=${encodeURIComponent(liveToken(s))}`;
  return (
    <Shell>
      <PageHead
        title="Sign in to LinkedIn"
        crumbs={[{ href: "/settings", label: "Settings" }]}
        sub="This window is a browser running on your LP Commons server. Sign in as you normally would, including any verification code. Your password goes straight to LinkedIn and is never stored; only the resulting session is saved, encrypted. Click the window first, then type. Google/Apple sign-in pop-ups aren't supported here: use your email and password."
      />
      <div className="card tight"><LiveLogin wsUrl={wsUrl} /></div>
    </Shell>
  );
}
