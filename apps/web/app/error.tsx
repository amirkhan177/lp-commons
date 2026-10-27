"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Shown when a page fails to render. The details stay in the server logs. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="content" style={{ maxWidth: 560, paddingTop: "14vh" }}>
      <div className="card empty">
        <h3>Something went wrong</h3>
        <p>This page couldn&apos;t load. Try again; if it keeps happening, check the server logs{error.digest ? ` (reference ${error.digest})` : ""}.</p>
        <div className="row">
          <button type="button" onClick={reset}>Try again</button>
          <Link className="btn secondary" href="/reach">Go to Reach</Link>
        </div>
      </div>
    </main>
  );
}
