import { isResponse, relay, requireSession, toWorkflows } from "../../../../src/twin/server";

/** Everything stored about the person, for the privacy screen. */
export async function GET() {
  const session = await requireSession();
  if (isResponse(session)) return session;
  return await relay(await toWorkflows(`/internal/twin/${session.userId}/inventory`));
}
