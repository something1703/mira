import { createService, type CreateServiceOptions, type ServiceContext } from "@mira/runtime";

/** mira-agent: Agent loop, tools, structured output, number injection, claim linter. */
export function buildApp(source?: CreateServiceOptions["source"]): ServiceContext {
  return createService({ service: "agent", ...(source ? { source } : {}) });
}
