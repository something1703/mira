import { workflowsUrl } from "../../../../../src/runs/api";

/** Read-only proxy so the run viewer in the browser never talks to the internal service directly. */
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  if (!/^run_[a-z0-9]{6,64}$/.test(runId))
    return Response.json({ error: "invalid_run_id" }, { status: 400 });
  try {
    const res = await fetch(`${workflowsUrl()}/internal/runs/${runId}`, { cache: "no-store" });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return Response.json({ error: "workflows_unreachable" }, { status: 502 });
  }
}
