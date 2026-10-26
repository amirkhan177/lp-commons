import { JetBrains_Mono, Orbitron } from "next/font/google";

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-hud-mono" });
const display = Orbitron({ subsets: ["latin"], variable: "--font-hud-display" });

/** Mission-mode theme wrapper (see .hud in globals.css). */
export default function HudShell({ children }: { children: React.ReactNode }) {
  return <div className={`hud ${mono.variable} ${display.variable}`}>{children}</div>;
}
