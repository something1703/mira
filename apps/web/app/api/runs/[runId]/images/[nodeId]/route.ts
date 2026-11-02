import { isResponse, requireSession, toWorkflows } from "../../../../../../src/twin/server";

/**
 * A preview from a run, for the person who started it, while the run's review window is open. It is
 * the image itself, never a link to YouCam's copy.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ runId: string; nodeId: string }> },
) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const { runId, nodeId } = await ctx.params;
  if (!/^run_[a-z0-9]{6,64}$/.test(runId) || !/^[a-z][a-z0-9_-]{0,63}$/.test(nodeId)) {
    return Response.json({ error: "invalid_id" }, { status: 400 });
  }
  const run = await toWorkflows(`/internal/runs/${runId}`);
  if (!run.ok) return Response.json({ error: "run_not_found" }, { status: 404 });
  const view = (await run.json()) as { run?: { userId?: string } };
  if (view.run?.userId !== session.userId) {
    return Response.json({ error: "run_not_found" }, { status: 404 });
  }
  const image = await toWorkflows(`/internal/runs/${runId}/images/${nodeId}`);
  if (!image.ok) return Response.json({ error: "image_gone" }, { status: 404 });
  return new Response(await image.arrayBuffer(), {
    headers: {
      "content-type": image.headers.get("content-type") ?? "image/png",
      "cache-control": "no-store",
    },
  });
}
