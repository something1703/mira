/**
 * `mira-web` is the only public service (docs/ARCHITECTURE.md §2), so the two public callbacks, the
 * YouCam webhook and the MIRA MCP endpoint, reach their services through it. Route handlers read
 * their targets at run time; `next.config` rewrites would bake the URLs in at build time.
 */
export interface ProxyOptions {
  /** Base URL of the internal service, no trailing slash. */
  target: string;
  /** Path on the target, starting with `/`. */
  path: string;
  /** Request headers to pass on. Everything else is dropped, including cookies. */
  forward: readonly string[];
  fetch?: typeof fetch;
}

export async function proxy(req: Request, o: ProxyOptions): Promise<Response> {
  const headers = new Headers();
  for (const name of o.forward) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  try {
    const upstream = await (o.fetch ?? fetch)(`${o.target}${o.path}`, {
      method: req.method,
      headers,
      // Text, not JSON: a webhook signature covers the exact bytes that arrived.
      ...(hasBody ? { body: await req.text() } : {}),
      redirect: "manual",
    });
    const out = new Headers();
    for (const name of ["content-type", "mcp-session-id", "www-authenticate", "cache-control"]) {
      const value = upstream.headers.get(name);
      if (value !== null) out.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch {
    return Response.json({ error: "upstream_unavailable" }, { status: 502 });
  }
}

export const webhookTarget = (): string => process.env.MIRA_WEBHOOK_URL ?? "http://localhost:4030";
export const mcpTarget = (): string => process.env.MIRA_MCP_URL ?? "http://localhost:4050";
