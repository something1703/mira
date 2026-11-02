import { Identity } from "@mira/runtime/identity";

/**
 * How the agent reaches `mira-workflows`: the only service that prices, starts and reads runs and
 * profiles (D10). A small port so tests can stand in for it. Live, the call carries the agent's
 * service identity; locally the services are open.
 */
export type WorkflowsReply = { ok: true; status: number; body: unknown } | { ok: false };

export interface Workflows {
  get(path: string): Promise<WorkflowsReply>;
  post(path: string, body: unknown): Promise<WorkflowsReply>;
  /** A raw body (a picture), for the upload route. */
  postBytes(path: string, bytes: Uint8Array, contentType: string): Promise<WorkflowsReply>;
}

export function httpWorkflows(
  base: string,
  options: { live: boolean; identity?: Identity; fetch?: typeof fetch } = { live: false },
): Workflows {
  const identity = options.identity ?? new Identity();
  const doFetch = options.fetch ?? fetch;
  const call = async (
    path: string,
    init: RequestInit,
    contentType = "application/json",
  ): Promise<WorkflowsReply> => {
    try {
      const auth = options.live ? await identity.headers(base) : {};
      const res = await doFetch(`${base}${path}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        ...init,
        headers: { "content-type": contentType, ...auth },
      });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text === "" ? null : JSON.parse(text);
      } catch {
        body = null;
      }
      return { ok: true, status: res.status, body };
    } catch {
      return { ok: false };
    }
  };
  return {
    get: (path) => call(path, { method: "GET" }),
    post: (path, body) => call(path, { method: "POST", body: JSON.stringify(body) }),
    postBytes: (path, bytes, contentType) =>
      call(path, { method: "POST", body: Buffer.from(bytes) }, contentType),
  };
}
