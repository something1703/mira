import { ShadeRange } from "@mira/schemas";
import { z } from "zod";
import { isResponse, relay, requireSession, toWorkflows } from "../../../../../src/twin/server";

/** A brand's range from product pages already read, or the sample range. */
export async function POST(req: Request) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const body = z
    .object({ ranges: z.array(ShadeRange).min(1).max(50), source: z.enum(["links", "sample"]) })
    .safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  return await relay(
    await toWorkflows("/internal/brand/catalogue/ranges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body.data, userId: session.userId }),
    }),
  );
}

export async function DELETE() {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const res = await toWorkflows(`/internal/brand/catalogue?userId=${session.userId}`, {
    method: "DELETE",
  });
  return res.status === 204 ? new Response(null, { status: 204 }) : await relay(res);
}
