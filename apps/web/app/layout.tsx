import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LP Commons",
  description: "Find warm intro paths to funds and LPs from public filings and your own network.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
