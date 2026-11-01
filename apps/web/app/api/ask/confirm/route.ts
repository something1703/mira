import { PlanId } from "@mira/schemas";
import { z } from "zod";
import { internalFetch } from "../../../../src/internal";
import { agentUrl } from "../../../../src/runs/api";
import { isResponse, relay, requireSession } from "../../../../src/twin/server";

/**
 * The Confirm button on a quote. This is the only way a plan becomes confirmed: it is a request
 * from the signed-in person's own browser, not text the assistant wrote.
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const body = z.object({ planId: PlanId }).safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  try {
    return await relay(
      await internalFetch(agentUrl(), `/internal/agent/plans/${body.data.planId}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: session.userId, sessionId: session.sessionId }),
        timeoutMs: 30_000,
      }),
    );
  } catch {
    return Response.json({ error: "assistant_unavailable" }, { status: 502 });
  }
}
