import { isResponse, requireSession, toWorkflows } from "../../../../src/twin/server";

/** A run's progress, for the person who started it only. Others get the same answer as a missing run. */
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const { runId } = await ctx.params;
  if (!/^run_[a-z0-9]{6,64}$/.test(runId)) {
    return Response.json({ error: "invalid_run_id" }, { status: 400 });
  }
  const res = await toWorkflows(`/internal/runs/${runId}`);
  if (!res.ok)
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  const view = (await res.json()) as { run?: { userId?: string } };
  if (view.run?.userId !== session.userId) {
    return Response.json({ error: "run_not_found" }, { status: 404 });
  }
  return Response.json(view, { headers: { "cache-control": "no-store" } });
}
