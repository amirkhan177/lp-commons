"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icons";

const closeNav = () => document.documentElement.removeAttribute("data-nav");

export function NavLink({ href, icon, children, badge }: { href: string; icon: IconName; children: React.ReactNode; badge?: React.ReactNode }) {
  const path = usePathname();
  const current = path === href || path.startsWith(`${href}/`) || (href === "/reach" && path.startsWith("/org/"));
  return (
    <Link href={href} className="side-link" aria-current={current ? "page" : undefined} onClick={closeNav}>
      <Icon name={icon} />
      <span>{children}</span>
      {badge}
    </Link>
  );
}

export function MenuButton() {
  return (
    <button type="button" className="icon-btn menu-btn" aria-label="Open navigation"
            onClick={() => document.documentElement.setAttribute("data-nav", "open")}>
      <Icon name="menu" />
    </button>
  );
}

export function Scrim() {
  const path = usePathname();
  useEffect(closeNav, [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeNav();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <div className="scrim" onClick={closeNav} aria-hidden />;
}

/** Light/dark switch. The choice is stored per browser; before a choice the OS setting applies. */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const set = document.documentElement.dataset.theme;
    setDark(set ? set === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch { /* private mode */ }
    window.dispatchEvent(new Event("themechange"));
  };
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            title={dark ? "Light mode" : "Dark mode"}>
      <Icon name={dark ? "sun" : "moon"} />
    </button>
  );
}
