import { Pool } from "pg";

// One pool per server process (survives Next dev hot reloads).
const g = globalThis as unknown as { lpcPool?: Pool };

export function db(): Pool {
  if (!g.lpcPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.lpcPool = new Pool({ connectionString: url, max: 5 });
  }
  return g.lpcPool;
}

// v1 is single-tenant: everything private lives in workspace 1 (created by migration 003).
export const WORKSPACE_ID = 1;
