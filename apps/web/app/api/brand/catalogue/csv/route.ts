import { z } from "zod";
import { isResponse, relay, requireSession, toWorkflows } from "../../../../../src/twin/server";

const MAX = 512 * 1024;

/** A brand's range as a spreadsheet: product, shade, hex. Read as data, never as instructions. */
export async function POST(req: Request) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const body = z
    .object({ csv: z.string().min(1).max(MAX) })
    .safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  return await relay(
    await toWorkflows("/internal/brand/catalogue/csv", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body.data, userId: session.userId }),
    }),
  );
}
