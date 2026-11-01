import { createService, type CreateServiceOptions, type ServiceContext } from "@mira/runtime";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { httpEngines, type Engines } from "./engines";
import { authenticate, parseTokens, UnitLedger, type TokenRecord } from "./tokens";
import { buildServer } from "./tools";

export interface McpDeps {
  engines?: Engines;
  tokens?: readonly TokenRecord[];
  ledger?: UnitLedger;
}

/**
 * mira-mcp: MIRA's own MCP server for other agents (docs/AGENT_RUNTIME.md §8). Stateless: each
 * request gets its own server and transport, so nothing about a caller is kept between calls. A
 * request needs a bearer token; a token has a daily unit cap.
 */
export function buildApp(
  source?: CreateServiceOptions["source"],
  deps: McpDeps = {},
): ServiceContext {
  const ctx = createService({ service: "mcp", ...(source ? { source } : {}) });
  const { app, env } = ctx;
  const tokens = deps.tokens ?? parseTokens(env.MIRA_MCP_TOKENS);
  const ledger = deps.ledger ?? new UnitLedger();
  const engines =
    deps.engines ?? httpEngines(env.MIRA_ENGINES_URL, { live: env.MIRA_MODE === "live" });

  app.post("/mcp", async (req, reply) => {
    const token = authenticate(req.headers.authorization, tokens);
    if (!token) {
      return await reply
        .status(401)
        .header("www-authenticate", 'Bearer realm="mira"')
        .send({ error: "unauthorised", traceId: req.traceId });
    }
    const server = buildServer({ engines, ledger, token });
    const transport = new StreamableHTTPServerTransport({});
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
  // Stateless: there is no stream to open or session to end.
  for (const method of ["get", "delete"] as const) {
    app[method](
      "/mcp",
      async (_req, reply) =>
        await reply.status(405).header("allow", "POST").send({ error: "method_not_allowed" }),
    );
  }
  return ctx;
}
