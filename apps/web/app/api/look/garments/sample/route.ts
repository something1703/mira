import { z } from "zod";
import { isResponse, relay, requireSession, toWorkflows } from "../../../../../src/twin/server";

/** Picks a sample garment. The person's id comes from the session, never the body. */
export async function POST(req: Request) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const body = z
    .object({ sampleId: z.string().min(1).max(80) })
    .safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  return await relay(
    await toWorkflows("/internal/look/garments/sample", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: session.userId, sampleId: body.data.sampleId }),
    }),
  );
}
