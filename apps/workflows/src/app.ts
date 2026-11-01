import { createService, type CreateServiceOptions, type ServiceContext } from "@mira/runtime";

/** mira-workflows: Graph runner, node lifecycle, unit ledger and result cache. */
export function buildApp(source?: CreateServiceOptions["source"]): ServiceContext {
  return createService({ service: "workflows", ...(source ? { source } : {}) });
}
