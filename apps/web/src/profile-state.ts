import { cookies } from "next/headers";

/** The Welcome screen's three states (docs/UX_FLOWS.md §1). */
export type ProfileState = "first_visit" | "returning" | "deleted";

const VALUES: readonly ProfileState[] = ["first_visit", "returning", "deleted"];

function isProfileState(value: string | undefined): value is ProfileState {
  return VALUES.includes(value as ProfileState);
}

/**
 * Where the state comes from. Until the profile store exists (Phase 5), a `mira_profile` cookie
 * set by the profile flows is the source. Outside live mode `?profile=` previews a state, so every
 * state can be reviewed and tested without a real profile.
 */
export async function profileState(preview: string | undefined): Promise<ProfileState> {
  if (process.env.MIRA_MODE !== "live" && isProfileState(preview)) return preview;
  const cookie = (await cookies()).get("mira_profile")?.value;
  if (cookie === "exists") return "returning";
  if (cookie === "deleted") return "deleted";
  return "first_visit";
}
