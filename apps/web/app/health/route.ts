import { MiraMode } from "@mira/schemas/env";

export const dynamic = "force-dynamic";

/** Liveness probe for Cloud Run and `pnpm dev:mock`, matching the other services' /health. */
export function GET(): Response {
  const mode = MiraMode.catch("mock").parse(process.env.MIRA_MODE);
  return Response.json({ ok: true, service: "mira-web", mode, version: "0.0.0" });
}
