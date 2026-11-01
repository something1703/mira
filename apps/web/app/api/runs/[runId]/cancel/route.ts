import { isResponse, relay, requireSession, toWorkflows } from "../../../../../src/twin/server";

/** Stops the steps that have not started. Steps already running finish, then the run closes. */
export async function POST(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const { runId } = await ctx.params;
  if (!/^run_[a-z0-9]{6,64}$/.test(runId)) {
    return Response.json({ error: "invalid_run_id" }, { status: 400 });
  }
  // Only the person who started a run may cancel it.
  const view = await toWorkflows(`/internal/runs/${runId}`);
  if (!view.ok) return await relay(view);
  const body = (await view.json()) as { run?: { userId?: string } };
  if (body.run?.userId !== session.userId) {
    return Response.json({ error: "run_not_found" }, { status: 404 });
  }
  return await relay(await toWorkflows(`/internal/runs/${runId}/cancel`, { method: "POST" }));
}
