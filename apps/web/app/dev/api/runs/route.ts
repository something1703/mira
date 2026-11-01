import { workflowsUrl } from "../../../../src/runs/api";

/** Starts a demo run on mira-workflows (mock mode only; it 404s in live). Development only. */
export async function POST() {
  const res = await fetch(`${workflowsUrl()}/internal/runs/demo`, {
    method: "POST",
    cache: "no-store",
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
