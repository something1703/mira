import { z } from "zod";
import { isResponse, relay, requireSession, toWorkflows } from "../../../../../src/twin/server";

/** Keeps the previews the person chose, past the run's review window. Only their own run. */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const { runId } = await ctx.params;
  const body = z
    .object({
      nodeIds: z
        .array(z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/))
        .min(1)
        .max(6),
    })
    .safeParse(await req.json().catch(() => undefined));
  if (!body.success || !/^run_[a-z0-9]{6,64}$/.test(runId)) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const run = await toWorkflows(`/internal/runs/${runId}`);
  if (!run.ok) return Response.json({ error: "run_not_found" }, { status: 404 });
  const view = (await run.json()) as { run?: { userId?: string } };
  if (view.run?.userId !== session.userId) {
    return Response.json({ error: "run_not_found" }, { status: 404 });
  }
  return await relay(
    await toWorkflows(`/internal/runs/${runId}/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeIds: body.data.nodeIds }),
    }),
  );
}
