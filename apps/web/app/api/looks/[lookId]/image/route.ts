import { isResponse, relay, requireSession, toWorkflows } from "../../../../../src/twin/server";

/** A saved look's picture, for the person who saved it only. */
export async function GET(req: Request, ctx: { params: Promise<{ lookId: string }> }) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const { lookId } = await ctx.params;
  if (!/^lk_[a-z0-9]{6,64}$/.test(lookId)) {
    return Response.json({ error: "invalid_look_id" }, { status: 400 });
  }
  const file = new URL(req.url).searchParams.get("file") ?? "";
  const res = await toWorkflows(
    `/internal/looks/${session.userId}/${lookId}/image?file=${encodeURIComponent(file)}`,
  );
  return res.ok
    ? new Response(await res.arrayBuffer(), {
        headers: {
          "content-type": res.headers.get("content-type") ?? "image/png",
          "cache-control": "no-store",
        },
      })
    : await relay(res);
}
