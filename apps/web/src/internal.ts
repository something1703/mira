import { Identity } from "@mira/runtime/identity";

/**
 * Calls from the web app to the private services. Live, Cloud Run only lets a caller in with an ID
 * token for the service it calls; in mock mode the services are on localhost and open.
 */
const identity = new Identity();
const live = () => process.env.MIRA_MODE === "live";

export async function internalFetch(
  base: string,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 15_000, headers, ...rest } = init;
  const auth = live() ? await identity.headers(base) : {};
  return await fetch(`${base}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
    ...rest,
    headers: { ...(headers as Record<string, string> | undefined), ...auth },
  });
}
