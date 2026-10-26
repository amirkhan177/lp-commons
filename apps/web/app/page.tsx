import { redirect } from "next/navigation";
import { isOnboarded } from "@/lib/onboarding";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// First visit goes to setup; afterwards straight to the reach overview.
export default async function Home() {
  await requireSession();
  redirect((await isOnboarded()) ? "/reach" : "/onboarding");
}
