// Hop weights shared by the per-fund path view and the background mapping agent.

export const WORKS_AT_WEIGHT = 0.7;
export const PAST_WORK_WEIGHT = 0.5; // worked there before (from LinkedIn work history)
export const SAME_FIRM_WEIGHT = 0.95;

/** Strength of a Form D role, by what the filer said the person does. */
export function roleWeight(relationships: string[]): number {
  return relationships.some((r) => r === "Executive Officer" || r === "Director") ? 1 : 0.8;
}

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

/** LinkedIn connection strength, by how recently you connected. */
export function linkedinStrength(connectedOn: string | null, today = new Date()): number {
  if (!connectedOn) return 0.6;
  const years = (today.getTime() - new Date(connectedOn).getTime()) / YEAR_MS;
  if (years <= 2) return 0.9;
  if (years <= 5) return 0.75;
  return 0.6;
}

/** Google strength: having actually met (calendar) beats being in your address book. */
export function googleStrength(meetings: number, lastMetOn: string | null, today = new Date()): number {
  if (meetings <= 0) return 0.55;
  const months = lastMetOn ? (today.getTime() - new Date(lastMetOn).getTime()) / (YEAR_MS / 12) : Infinity;
  if (meetings >= 3 && months <= 12) return 0.95;
  if (months <= 6) return 0.9;
  return meetings >= 3 ? 0.85 : 0.7;
}
