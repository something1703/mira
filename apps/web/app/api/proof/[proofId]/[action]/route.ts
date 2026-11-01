import { ProofId } from "@mira/schemas";
import { isResponse, relay, requireSession, toWorkflows } from "../../../../../src/twin/server";

const ACTIONS = new Set(["begin", "stop", "confound", "review"]);

/** Begin, stop, flag a confound, or publish the measured review (which needs an explicit yes). */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ proofId: string; action: string }> },
) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const { proofId, action } = await ctx.params;
  const id = ProofId.safeParse(proofId);
  if (!id.success || !ACTIONS.has(action)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { consent?: unknown };
  return await relay(
    await toWorkflows(`/internal/proof/${id.data}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: session.userId,
        ...(action === "review" ? { consent: body.consent === true ? true : undefined } : {}),
      }),
    }),
  );
}
