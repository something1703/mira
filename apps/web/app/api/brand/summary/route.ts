import { isResponse, relay, requireSession, toWorkflows } from "../../../../src/twin/server";

/** The brand console's views. Closed outside mock mode until brand sign-in exists (D41). */
export async function GET() {
  const session = await requireSession();
  if (isResponse(session)) return session;
  return await relay(
    await toWorkflows(`/internal/brand/summary?userId=${session.userId}`, {}, 30_000),
  );
}
