import { z } from "zod";
import { isResponse, relay, requireSession, toWorkflows } from "../../../../src/twin/server";

const key = z.string().min(1).max(200);
const Body = z.object({
  capture: z.object({
    face: key,
    repeats: z.array(key).max(2).optional(),
    hair: z.object({ front: key, right: key.optional(), left: key.optional() }).optional(),
    mode: z.enum(["hd", "sd"]),
    source: z.enum(["camera", "upload"]),
    qualityChecksPassed: z.boolean().nullable(),
    only: z
      .array(z.enum(["skin", "colouring", "face", "hair"]))
      .min(1)
      .optional(),
  }),
  removed: z.array(z.string().min(1)).max(20).optional(),
  confirmedTotal: z.number().int().nonnegative().optional(),
});

/** quote: the person's ids come from the session cookie, never from the body. */
export async function POST(req: Request) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const body = Body.safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  const res = await toWorkflows("/internal/twin/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body.data, userId: session.userId, sessionId: session.sessionId }),
  });
  return await relay(res);
}
