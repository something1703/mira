import { createService, type CreateServiceOptions, type ServiceContext } from "@mira/runtime";

/** mira-webhook: Receives YouCam task callbacks and advances graphs. */
export function buildApp(source?: CreateServiceOptions["source"]): ServiceContext {
  return createService({ service: "webhook", ...(source ? { source } : {}) });
}
