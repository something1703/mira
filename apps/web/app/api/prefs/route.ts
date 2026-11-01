import { Prefs } from "@mira/schemas";
import { isResponse, relay, requireSession, toWorkflows } from "../../../src/twin/server";

/** Whether the person lets anonymised readings feed brand summaries. Off until they say yes. */
export async function GET() {
  const session = await requireSession();
  if (isResponse(session)) return session;
  return await relay(await toWorkflows(`/internal/prefs/${session.userId}`));
}

export async function PUT(req: Request) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const body = Prefs.safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  return await relay(
    await toWorkflows(`/internal/prefs/${session.userId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body.data),
    }),
  );
}
