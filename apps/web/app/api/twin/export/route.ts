import { isResponse, requireSession, toWorkflows } from "../../../../src/twin/server";

/** Download my data: every stored value as one JSON file. */
export async function GET() {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const res = await toWorkflows(`/internal/twin/${session.userId}/export`);
  if (!res.ok) return Response.json({ error: "export_failed" }, { status: res.status });
  return new Response(await res.text(), {
    headers: {
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="mira-my-data.json"',
      "cache-control": "no-store",
    },
  });
}
