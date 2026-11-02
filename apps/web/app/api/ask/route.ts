import { AskContext, AskResponse, ChatMessage } from "@mira/schemas";
import { z } from "zod";
import { internalFetch } from "../../../src/internal";
import { agentUrl } from "../../../src/runs/api";
import { isResponse, requireSession } from "../../../src/twin/server";

const Body = z.object({
  messages: z.array(ChatMessage).min(1).max(40),
  // The panel never sends a photo: a held photo belongs to the screen that took it.
  context: AskContext.omit({ heldPhoto: true }),
});

/** Ask MIRA. The person's ids come from the session cookie, never from the body. */
export async function POST(req: Request) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const body = Body.safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  try {
    const res = await internalFetch(agentUrl(), "/internal/agent/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...body.data,
        userId: session.userId,
        sessionId: session.sessionId,
      }),
      timeoutMs: 60_000,
    });
    if (!res.ok) return Response.json({ error: "assistant_unavailable" }, { status: 502 });
    const parsed = AskResponse.safeParse(await res.json());
    // A reply that does not match the schema is never shown.
    return parsed.success
      ? Response.json(parsed.data, { headers: { "cache-control": "no-store" } })
      : Response.json({ error: "assistant_unavailable" }, { status: 502 });
  } catch {
    return Response.json({ error: "assistant_unavailable" }, { status: 502 });
  }
}
