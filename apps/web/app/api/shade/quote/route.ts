import { ShadeRange } from "@mira/schemas";
import { z } from "zod";
import { isResponse, relay, requireSession, toWorkflows } from "../../../../src/twin/server";

const Body = z.object({
  range: ShadeRange,
  photo: z.string().min(1).max(200),
  topN: z.number().int().min(1).max(5).optional(),
  shadeIds: z.array(z.string().min(1)).min(1).max(5).optional(),
  removedShadeIds: z.array(z.string().min(1)).max(5).optional(),
  concealer: z.boolean().optional(),
  confirmedTotal: z.number().int().nonnegative().optional(),
});

/** Shade match, quote. The person's ids come from the session cookie, never from the body. */
export async function POST(req: Request) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const body = Body.safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  return await relay(
    await toWorkflows("/internal/shade/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body.data, userId: session.userId, sessionId: session.sessionId }),
    }),
  );
}
