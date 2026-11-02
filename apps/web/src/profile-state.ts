import { cookies } from "next/headers";
import { loadProfile } from "./profile/load";

/** The Welcome screen's three states (docs/UX_FLOWS.md §1). */
export type ProfileState = "first_visit" | "returning" | "deleted";

const VALUES: readonly ProfileState[] = ["first_visit", "returning", "deleted"];

function isProfileState(value: string | undefined): value is ProfileState {
  return VALUES.includes(value as ProfileState);
}

/**
 * Where the state comes from: the saved profile, with the `mira_profile` cookie the profile flows
 * set as the fallback when the profile service cannot be reached. With synthetic YouCam
 * `?profile=` previews a state, so every state can be reviewed and tested without a real profile.
 */
export async function profileState(preview: string | undefined): Promise<ProfileState> {
  const previews = process.env.MIRA_MODE !== "live" && process.env.MIRA_YOUCAM !== "live";
  if (previews && isProfileState(preview)) return preview;
  // A person who has just measured is "returning" at once, not after the profile page has run.
  const loaded = await loadProfile();
  if (loaded.kind === "twin") return "returning";
  if (loaded.kind === "none") return loaded.deleted ? "deleted" : "first_visit";
  // Profile service unreachable: fall back to the cookie the profile flows set.
  const cookie = (await cookies()).get("mira_profile")?.value;
  if (cookie === "exists") return "returning";
  if (cookie === "deleted") return "deleted";
  return "first_visit";
}
