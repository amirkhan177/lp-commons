"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-render the server page while background work (mapping, data load) is in progress. */
export default function AutoRefresh({ active, everyMs = 4000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs, router]);
  return null;
}
