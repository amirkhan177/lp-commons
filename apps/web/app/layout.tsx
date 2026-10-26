import type { Metadata } from "next";
import "./globals.css";
import HudShell from "./hud-shell";

export const metadata: Metadata = {
  title: "LP Commons",
  description: "Find warm intro paths to funds and LPs from public filings and your own network.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><HudShell>{children}</HudShell></body>
    </html>
  );
}
