import { NextResponse, type NextRequest } from "next/server";
import { agentSecretMatches } from "@/lib/agent-link";
import { enqueueMapping } from "@/lib/agent/run";

// Called by the SEC scraper over the private network after a run that added filings.
export async function POST(req: NextRequest) {
  if (!agentSecretMatches(req.headers.get("x-agent-secret"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  await enqueueMapping("new_filings");
  return NextResponse.json({ ok: true });
}
