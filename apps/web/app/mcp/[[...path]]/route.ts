import { mcpTarget, proxy } from "../../../src/proxy";

type Ctx = { params: Promise<{ path?: string[] }> };

async function handle(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  const suffix = path && path.length > 0 ? `/${path.map(encodeURIComponent).join("/")}` : "";
  return await proxy(req, {
    target: mcpTarget(),
    path: `/mcp${suffix}${new URL(req.url).search}`,
    // Token auth is enforced by mira-mcp itself; the proxy only carries the header.
    forward: ["authorization", "content-type", "accept", "mcp-session-id", "mcp-protocol-version"],
  });
}

export { handle as DELETE, handle as GET, handle as POST };
