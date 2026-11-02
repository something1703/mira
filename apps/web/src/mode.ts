/**
 * Whether this server spends real YouCam units: live mode, or local state with real YouCam
 * (`pnpm dev:real` and the single-VM deploy). Where it does, nothing is run on the drawn sample
 * face, because that would spend real units on a picture of no one.
 */
export function spendsRealUnits(env: Record<string, string | undefined> = process.env): boolean {
  return env.MIRA_MODE === "live" || env.MIRA_YOUCAM === "live";
}
