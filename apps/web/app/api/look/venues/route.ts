import { internalFetch } from "../../../../src/internal";
import { agentUrl } from "../../../../src/runs/api";
import { isResponse, requireSession } from "../../../../src/twin/server";

/** Venue presets YouCam offers, found by the assistant's discovery path. Empty when unavailable. */
export async function GET(req: Request) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const venue = new URL(req.url).searchParams.get("type") ?? "";
  if (!/^[a-z]{2,20}$/.test(venue))
    return Response.json({ error: "invalid_query" }, { status: 400 });
  try {
    const res = await internalFetch(agentUrl(), `/internal/look/backgrounds?venue=${venue}`);
    return res.ok ? Response.json(await res.json()) : Response.json({ items: [] });
  } catch {
    return Response.json({ items: [] });
  }
}
