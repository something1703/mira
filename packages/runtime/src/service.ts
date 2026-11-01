import Fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
} from "fastify";
import { loadEnv, type MiraEnv, type ServiceName } from "@mira/schemas/env";
import { TRACE_HEADER, traceIdFrom } from "@mira/schemas";
import { createLogger, type Logger } from "./logger";

declare module "fastify" {
  interface FastifyRequest {
    /** The run's trace ID, from `x-mira-trace` or freshly minted; also bound to `request.log`. */
    traceId: string;
  }
}

export interface ServiceContext {
  readonly env: MiraEnv;
  readonly logger: Logger;
  readonly app: FastifyInstance;
}

export interface CreateServiceOptions {
  readonly service: ServiceName;
  /** Inject an environment in tests; defaults to process.env. */
  readonly source?: Record<string, string | undefined>;
  readonly version?: string;
}

/** The error copy for unhandled failures (docs/UX_FLOWS.md §0, "Unexpected error"). */
export const UNEXPECTED_ERROR_COPY =
  "Something failed on our side. The run was stopped and no units were charged for unfinished steps.";

/**
 * Builds a Fastify service with what every MIRA service shares: validated env (fails fast),
 * structured logger, trace-ID propagation via `x-mira-trace`, `/health`, and an error handler that
 * returns the trace ID instead of internals.
 */
export function createService(options: CreateServiceOptions): ServiceContext {
  const env = loadEnv(options.service, options.source);
  const logger = createLogger(env);
  // Pino is Fastify's logger; widening to its base type keeps FastifyInstance un-parameterised.
  const baseLogger: FastifyBaseLogger = logger;
  const app: FastifyInstance = Fastify({
    loggerInstance: baseLogger,
    // Fastify's own request lines would log raw URLs; MIRA logs one scrubbed line per request.
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: "traceId" }),
    bodyLimit: 12 * 1024 * 1024,
    genReqId: (req) => {
      const header = req.headers[TRACE_HEADER];
      return traceIdFrom(Array.isArray(header) ? header[0] : header);
    },
  });

  app.decorateRequest("traceId", "");
  app.addHook("onRequest", async (req, reply) => {
    req.traceId = req.id;
    void reply.header(TRACE_HEADER, req.id);
  });

  app.addHook("onResponse", async (req, reply) => {
    if (req.url === "/health") return;
    req.log.info(
      {
        method: req.method,
        route: req.routeOptions.url,
        status: reply.statusCode,
        ms: Math.round(reply.elapsedTime),
      },
      "request",
    );
  });

  app.setErrorHandler((error: FastifyError, req, reply) => {
    const status =
      typeof error.statusCode === "number" && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) req.log.error({ err: error }, "unhandled error");
    void reply.status(status).send({
      error: status >= 500 ? "unexpected" : error.code,
      message: status >= 500 ? UNEXPECTED_ERROR_COPY : error.message,
      traceId: req.traceId,
    });
  });

  app.get("/health", () => ({
    ok: true,
    service: `mira-${options.service}`,
    mode: env.MIRA_MODE,
    version: options.version ?? "0.0.0",
  }));

  return { env, logger, app };
}

/** Starts listening and shuts down cleanly on SIGTERM (Cloud Run sends it before stopping). */
export async function listen(ctx: ServiceContext): Promise<void> {
  const port = ctx.env.PORT ?? 8080;
  await ctx.app.listen({ port, host: "0.0.0.0" });
  ctx.logger.info({ port }, "listening");
  const stop = (signal: string) => {
    ctx.logger.info({ signal }, "shutting down");
    void ctx.app.close().then(() => process.exit(0));
  };
  process.once("SIGTERM", () => {
    stop("SIGTERM");
  });
  process.once("SIGINT", () => {
    stop("SIGINT");
  });
}
