import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/constants";
import { unreadCount } from "@/lib/notify";
import { isOnboarded } from "@/lib/onboarding";
import { Icon } from "./icons";
import { Logo } from "./logo";
import { MenuButton, NavLink, Scrim, ThemeToggle } from "./shell-client";

async function logout() {
  "use server";
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

/** App frame for signed-in pages: sidebar, top bar with fund search, and the page content. */
export default async function Shell({ children }: { children: React.ReactNode }) {
  const [unread, onboarded] = await Promise.all([unreadCount(), isOnboarded()]);
  return <ShellFrame unread={unread} onboarded={onboarded}>{children}</ShellFrame>;
}

/** The frame without data loading, so loading and error screens can show it instantly. */
export function ShellFrame({ unread = 0, onboarded = true, children }: { unread?: number; onboarded?: boolean; children: React.ReactNode }) {
  return (
    <div className="app">
      <aside className="sidebar" aria-label="Main navigation">
        <Link href="/reach" className="brand"><Logo size={32} />LP Commons</Link>
        <nav className="side-nav">
          <div className="side-group">
            <div className="side-label">Fundraise</div>
            <NavLink href="/reach" icon="reach" badge={unread > 0 ? <span className="badge">{unread} new</span> : null}>Reach</NavLink>
            <NavLink href="/matches" icon="matches">Matches</NavLink>
            <NavLink href="/map" icon="map">Path mapper</NavLink>
          </div>
          <div className="side-group">
            <div className="side-label">Your data</div>
            <NavLink href="/import" icon="network">Your network</NavLink>
            <NavLink href="/profile" icon="profile">Fund profile</NavLink>
          </div>
          <div className="side-group">
            <div className="side-label">Account</div>
            <NavLink href="/settings" icon="settings">Settings</NavLink>
            <NavLink href="/onboarding" icon="setup" badge={!onboarded ? <span className="badge warn">To do</span> : null}>Setup</NavLink>
          </div>
        </nav>
        <div className="side-foot">
          <form action={logout}>
            <button type="submit" className="side-link"><Icon name="logout" /><span>Sign out</span></button>
          </form>
        </div>
      </aside>
      <Scrim />
      <div className="main">
        <header className="topbar">
          <MenuButton />
          <form method="get" action="/map" className="top-search" role="search">
            <Icon name="search" size={18} />
            <input type="search" name="q" placeholder="Search funds or management companies…" aria-label="Search funds" autoComplete="off" />
          </form>
          <div className="top-actions">
            <ThemeToggle />
            <Link href="/reach" className="icon-btn" aria-label={unread ? `${unread} new results` : "Notifications"}>
              <Icon name="bell" />
              {unread > 0 && <span className="dot">{unread > 9 ? "9+" : unread}</span>}
            </Link>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

export function PageHead({ title, sub, actions, crumbs }: {
  title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; crumbs?: { href: string; label: string }[];
}) {
  return (
    <div className="page-head">
      <div>
        {crumbs && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c) => <span key={c.href}><Link href={c.href}>{c.label}</Link> /</span>)}
          </nav>
        )}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Notice({ kind = "warn", children }: { kind?: "ok" | "error" | "info" | "warn"; children: React.ReactNode }) {
  return (
    <div className={`notice ${kind === "warn" ? "" : kind}`} role={kind === "error" ? "alert" : "status"}>
      <Icon name={kind === "ok" ? "check" : kind === "info" ? "info" : "alert"} size={18} />
      <div>{children}</div>
    </div>
  );
}

/** ?ok= / ?error= flash messages from server actions. */
export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return <div style={{ marginBottom: 20 }}>{ok ? <Notice kind="ok">{ok}</Notice> : <Notice kind="error">{error}</Notice>}</div>;
}

export function Empty({ icon = "info", title, children, actions }: {
  icon?: Parameters<typeof Icon>[0]["name"]; title: string; children?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={24} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
