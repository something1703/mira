import { z } from "zod";
import { internalFetch } from "../../../../src/internal";
import { agentUrl } from "../../../../src/runs/api";
import { RateLimit } from "../../../../src/twin/rate";
import { isResponse, relay, requireSession } from "../../../../src/twin/server";

// A page read is a request MIRA makes to somebody else's website, so it is limited per person.
const limit = new RateLimit(12, 60 * 60_000);

/** Reads the claim a pasted product page makes (the agent fetches it with the SSRF guard). */
export async function POST(req: Request) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const body = z
    .object({ url: z.string().min(1).max(2_000) })
    .safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  if (!limit.take(session.userId)) {
    return Response.json({ error: "too_many_reads" }, { status: 429 });
  }
  try {
    return await relay(
      await internalFetch(agentUrl(), "/internal/extract/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: body.data.url }),
        timeoutMs: 30_000,
      }),
    );
  } catch {
    return Response.json({ error: "agent_unreachable" }, { status: 502 });
  }
}
