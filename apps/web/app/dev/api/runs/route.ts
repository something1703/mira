import { currentSession } from "../../../../src/budget";
import { internalFetch } from "../../../../src/internal";
import { workflowsUrl } from "../../../../src/runs/api";

/** Starts a demo run on mira-workflows (mock mode only; it 404s in live). Development only. */
export async function POST(req: Request) {
  // An optional tag gives the demo its own placeholder photo, so tests sharing a server stay independent.
  const tag = new URL(req.url).searchParams.get("tag");
  // The person's own session, so the demo spends from (and shows) their unit budget.
  const session = await currentSession();
  const res = await internalFetch(workflowsUrl(), "/internal/runs/demo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...(session ?? {}), ...(tag ? { tag } : {}) }),
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
