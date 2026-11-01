import { ProofId } from "@mira/schemas";
import { isResponse, relay, requireSession, toWorkflows } from "../../../../src/twin/server";

type Ctx = { params: Promise<{ proofId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const id = ProofId.safeParse((await ctx.params).proofId);
  if (!id.success) return Response.json({ error: "invalid_id" }, { status: 400 });
  return await relay(await toWorkflows(`/internal/proof/${session.userId}/${id.data}`));
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const id = ProofId.safeParse((await ctx.params).proofId);
  if (!id.success) return Response.json({ error: "invalid_id" }, { status: 400 });
  const res = await toWorkflows(`/internal/proof/${session.userId}/${id.data}`, {
    method: "DELETE",
  });
  return res.status === 204 ? new Response(null, { status: 204 }) : await relay(res);
}
