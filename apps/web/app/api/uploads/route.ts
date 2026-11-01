import { isResponse, relay, requireSession, toWorkflows } from "../../../src/twin/server";

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png"]);

/**
 * A capture or uploaded photo, sent as the raw file. It goes to storage under the person's own
 * prefix and stays only until the run that reads it ends (docs/SECURITY_PRIVACY.md §1).
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const type = req.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!TYPES.has(type)) return Response.json({ error: "unsupported_type" }, { status: 415 });
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) {
    return Response.json({ error: "too_large", maxBytes: MAX_BYTES }, { status: 413 });
  }
  const bytes = await req.arrayBuffer();
  const res = await toWorkflows(
    `/internal/uploads?userId=${session.userId}`,
    { method: "POST", headers: { "content-type": type }, body: bytes },
    30_000,
  );
  return await relay(res);
}

export async function DELETE(req: Request) {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const res = await toWorkflows(
    `/internal/uploads?userId=${session.userId}&key=${encodeURIComponent(key)}`,
    { method: "DELETE" },
  );
  return res.status === 204 ? new Response(null, { status: 204 }) : await relay(res);
}
