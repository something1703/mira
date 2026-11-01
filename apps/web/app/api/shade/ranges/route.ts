import { isResponse, relay, requireSession, toWorkflows } from "../../../../src/twin/server";

/** The shade ranges MIRA has on file. Today they are samples, and each one says so. */
export async function GET() {
  const session = await requireSession();
  if (isResponse(session)) return session;
  return await relay(await toWorkflows("/internal/shade/ranges"));
}
