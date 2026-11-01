import { GarmentCategory, GarmentKind } from "@mira/schemas";
import { z } from "zod";
import { isResponse, relay, requireSession, toWorkflows } from "../../../../../src/twin/server";

const Body = z.object({
  photo: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
  kind: GarmentKind,
  category: GarmentCategory,
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("link"), url: z.string().max(2_000) }),
    z.object({ kind: z.literal("upload") }),
  ]),
  confirmedTotal: z.number().int().nonnegative().optional(),
});

const ROUTES: Record<string, string> = {
  quote: "/internal/look/garments/quote",
  ingest: "/internal/look/garments/ingest",
};

/** Garment colour reading: a quote first, then the run. Ids come from the session cookie. */
export async function POST(req: Request, ctx: { params: Promise<{ step: string }> }) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const path = ROUTES[(await ctx.params).step];
  if (path === undefined) return Response.json({ error: "not_found" }, { status: 404 });
  const body = Body.safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  return await relay(
    await toWorkflows(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body.data, userId: session.userId, sessionId: session.sessionId }),
    }),
  );
}
