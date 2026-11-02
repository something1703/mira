import { Claim } from "@mira/schemas";
import { z } from "zod";
import { isResponse, relay, requireSession, toWorkflows } from "../../../src/twin/server";

const Body = z.object({
  product: z.object({ name: z.string().min(1).max(120), url: z.string().max(2_000).optional() }),
  claim: Claim,
});

/** The person's proofs. Their id comes from the session cookie, never from the request. */
export async function GET() {
  const session = await requireSession();
  if (isResponse(session)) return session;
  return await relay(await toWorkflows(`/internal/proof/${session.userId}`));
}

export async function POST(req: Request) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const body = Body.safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  return await relay(
    await toWorkflows("/internal/proof", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body.data, userId: session.userId }),
    }),
  );
}
