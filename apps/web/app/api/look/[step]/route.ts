import { z } from "zod";
import { isResponse, relay, requireSession, toWorkflows } from "../../../../src/twin/server";

const Id = z.string().min(1).max(80);
const Body = z.object({
  photo: z.string().min(1).max(200).optional(),
  outfitId: Id,
  shoesId: Id.optional(),
  bagId: Id.optional(),
  bagGender: z.enum(["female", "male"]).optional(),
  makeup: z.boolean().optional(),
  hairHex: z
    .string()
    .regex(/^#[0-9A-F]{6}$/)
    .optional(),
  venue: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("prompt"), prompt: z.string().min(1).max(1_500) }),
      z.object({ type: z.literal("template"), templateId: z.string().min(1).max(120) }),
    ])
    .optional(),
  video: z.boolean().optional(),
  removedSteps: z.array(z.string().min(1).max(20)).max(10).optional(),
  confirmedTotal: z.number().int().nonnegative().optional(),
});

const ROUTES: Record<string, string> = {
  suggest: "/internal/look/suggest",
  quote: "/internal/look/quote",
  build: "/internal/look/build",
};

/** Suggestion, quote and build for a look. Ids come from the session cookie, never the body. */
export async function POST(req: Request, ctx: { params: Promise<{ step: string }> }) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const step = (await ctx.params).step;
  const path = ROUTES[step];
  if (path === undefined) return Response.json({ error: "not_found" }, { status: 404 });
  const body = Body.safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  if (step !== "suggest" && body.data.photo === undefined) {
    return Response.json({ error: "photo_required" }, { status: 400 });
  }
  return await relay(
    await toWorkflows(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body.data, userId: session.userId, sessionId: session.sessionId }),
    }),
  );
}
