import {
  isResponse,
  relay,
  requireSession,
  setProfileCookie,
  toWorkflows,
} from "../../../src/twin/server";

/** The person's measured profile. Reading it also keeps the Welcome screen's cookie truthful. */
export async function GET() {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const res = await toWorkflows(`/internal/twin/${session.userId}`);
  if (res.ok) await setProfileCookie("exists");
  return await relay(res);
}

/** Delete my profile: the Twin, proofs, saved looks, saved images, runs and cached results. */
export async function DELETE() {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const res = await toWorkflows(`/internal/twin/${session.userId}`, { method: "DELETE" }, 30_000);
  if (res.ok) await setProfileCookie("deleted");
  return await relay(res);
}
