import { ShadeRange } from "@mira/schemas";
import { z } from "zod";
import { isResponse, relay, requireSession, toWorkflows } from "../../../../src/twin/server";

/** Ranks a range against the person's measured skin. Free, and it needs no photo. */
export async function POST(req: Request) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const body = z.object({ range: ShadeRange }).safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  return await relay(
    await toWorkflows("/internal/shade/prerank", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: session.userId, range: body.data.range }),
    }),
  );
}
