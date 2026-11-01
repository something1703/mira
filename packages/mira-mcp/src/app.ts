import { createService, type CreateServiceOptions, type ServiceContext } from "@mira/runtime";

/** mira-mcp: MIRA's own MCP server for external agents (phase 10). */
export function buildApp(source?: CreateServiceOptions["source"]): ServiceContext {
  return createService({ service: "mcp", ...(source ? { source } : {}) });
}
