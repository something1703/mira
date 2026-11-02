import { AskResponse } from "@mira/schemas";
import { z } from "zod";
import { internalFetch } from "../../../../src/internal";
import { agentUrl } from "../../../../src/runs/api";
import { isResponse, requireSession } from "../../../../src/twin/server";

/** The assistant describes a run that has finished. Only the person's own runs are narrated. */
export async function POST(req: Request) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const body = z
    .object({ runId: z.string().regex(/^run_[a-z0-9]{6,64}$/) })
    .safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  try {
    const res = await internalFetch(agentUrl(), "/internal/agent/narrate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: session.userId, runId: body.data.runId }),
      timeoutMs: 60_000,
    });
    if (!res.ok) return Response.json({ error: "assistant_unavailable" }, { status: 502 });
    const parsed = AskResponse.safeParse(await res.json());
    return parsed.success
      ? Response.json(parsed.data, { headers: { "cache-control": "no-store" } })
      : Response.json({ error: "assistant_unavailable" }, { status: 502 });
  } catch {
    return Response.json({ error: "assistant_unavailable" }, { status: 502 });
  }
}
