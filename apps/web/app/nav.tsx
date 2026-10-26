import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/constants";

async function logout() {
  "use server";
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export default function Nav() {
  return (
    <header className="topbar">
      <Link href="/map" className="brand">LP Commons</Link>
      <nav>
        <Link href="/map">Path mapper</Link>
        <Link href="/import">Your network</Link>
      </nav>
      <form action={logout}><button className="secondary" type="submit">Sign out</button></form>
    </header>
  );
}
