"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { enqueueMapping } from "@/lib/agent/run";
import { importContacts, runMatching } from "@/lib/import";
import { parseLinkedInConnections } from "@/lib/linkedin-csv";
import { requireSession } from "@/lib/session";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const RETURN_TO = new Set(["/import", "/onboarding"]);

/** LinkedIn Connections.csv upload, used by the import page and onboarding. */
export async function uploadConnections(formData: FormData) {
  await requireSession();
  const back = RETURN_TO.has(String(formData.get("returnTo"))) ? String(formData.get("returnTo")) : "/import";
  const fail = (msg: string) => redirect(`${back}?error=${encodeURIComponent(msg)}`);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) fail("Choose a CSV file.");
  if ((file as File).size > MAX_UPLOAD_BYTES) fail("File is larger than 10 MB.");
  let message: string;
  try {
    const contacts = parseLinkedInConnections(await (file as File).text());
    const { imported } = await importContacts(contacts);
    const { auto, possible } = await runMatching();
    message = `Imported ${imported} connections. ${auto} matched to people in filings, ${possible} possible matches to review. Mapping your network in the background — you'll get a notification when it's ready.`;
    await enqueueMapping("linkedin_import");
  } catch (e) {
    fail(e instanceof Error ? e.message : "Import failed.");
  }
  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent(message!)}`);
}
