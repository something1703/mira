import { isResponse, relay, requireSession, toWorkflows } from "../../../../src/twin/server";

/** Sample garments to browse (mock mode only; live mode lists none). */
export async function GET() {
  const session = await requireSession();
  if (isResponse(session)) return session;
  return await relay(await toWorkflows("/internal/look/catalogue"));
}
