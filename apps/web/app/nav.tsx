import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/constants";
import { unreadCount } from "@/lib/notify";
import { isOnboarded } from "@/lib/onboarding";

async function logout() {
  "use server";
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export default async function Nav() {
  const [unread, onboarded] = await Promise.all([unreadCount(), isOnboarded()]);
  return (
    <header className="topbar">
      <Link href="/reach" className="brand">LP Commons</Link>
      <nav>
        <Link href="/reach">Reach{unread > 0 && <span className="badge ok" title="New results">{unread} new</span>}</Link>
        <Link href="/matches">Matches</Link>
        <Link href="/map">Path mapper</Link>
        <Link href="/import">Your network</Link>
        <Link href="/settings">Settings</Link>
        {!onboarded && <Link href="/onboarding">Setup<span className="badge warn">to do</span></Link>}
      </nav>
      <form action={logout}><button className="secondary" type="submit">Sign out</button></form>
    </header>
  );
}
