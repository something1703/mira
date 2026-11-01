import { currentSession } from "../../../../src/budget";
import { workflowsUrl } from "../../../../src/runs/api";

/** Starts a demo run on mira-workflows (mock mode only; it 404s in live). Development only. */
export async function POST() {
  // The person's own session, so the demo spends from (and shows) their unit budget.
  const session = await currentSession();
  const res = await fetch(`${workflowsUrl()}/internal/runs/demo`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(session ?? {}),
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
