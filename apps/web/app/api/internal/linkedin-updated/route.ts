import { NextResponse, type NextRequest } from "next/server";
import { agentSecretMatches } from "@/lib/agent-link";
import { enqueueMapping } from "@/lib/agent/run";
import { runMatching } from "@/lib/import";

// Called by the LinkedIn agent over the private network after it saves new connections or profiles.
export async function POST(req: NextRequest) {
  if (!agentSecretMatches(req.headers.get("x-agent-secret"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  await runMatching();
  await enqueueMapping("linkedin_agent");
  return NextResponse.json({ ok: true });
}
