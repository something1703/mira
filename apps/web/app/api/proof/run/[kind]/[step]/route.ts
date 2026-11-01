import { ProofId } from "@mira/schemas";
import { z } from "zod";
import { isResponse, relay, requireSession, toWorkflows } from "../../../../../../src/twin/server";

const Key = z.string().min(1).max(200);
const Base = { proofId: ProofId, confirmedTotal: z.number().int().nonnegative().optional() };
const BODIES = {
  session: z.object({
    ...Base,
    kind: z.enum(["baseline", "check_in"]),
    photos: z.array(Key).min(1).max(5),
    confound: z.boolean().optional(),
  }),
  phantom: z.object({ ...Base, photo: Key }),
  visual: z.object({ ...Base, photo: Key, target: z.enum(["verdict", "preview"]) }),
} as const;
const PATHS = { quote: "quote", start: "start" } as const;

/** A session of captures, the calibration phantom or a visualisation: a quote first, then the run. */
export async function POST(req: Request, ctx: { params: Promise<{ kind: string; step: string }> }) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const { kind, step } = await ctx.params;
  if (!(kind in BODIES) || !(step in PATHS)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const schema = BODIES[kind as keyof typeof BODIES];
  const body = schema.safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  return await relay(
    await toWorkflows(`/internal/proof/${kind}/${step}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...body.data,
        userId: session.userId,
        sessionId: session.sessionId,
      }),
    }),
  );
}
