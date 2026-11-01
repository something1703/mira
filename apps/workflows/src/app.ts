import {
  createService,
  createMockPorts,
  type CreateServiceOptions,
  type Ports,
  type ServiceContext,
  type EventBus,
} from "@mira/runtime";
import { Run, RunNode, WorkItem } from "@mira/schemas";
import { getDoc, listDocs } from "@mira/runtime";
import { HttpYouCamApi, type YouCamApi } from "@mira/youcam-client";
import { FakeYouCam } from "@mira/youcam-client/testing";
import { z } from "zod";
import { DEMO_PRICES, demoExecutors, newDemoSession, seedDemoFake, startDemoRun } from "./demo";
import { createEngine, type Engine } from "./engine";
import { RUN_EVENTS_TOPIC, type Downloader } from "./lifecycle/types";

export const ENGINE_VERSION = "0.1.0";

export interface WorkflowsOptions {
  /** Directory for file-backed mock state; omit for in-memory (tests). */
  dataDir?: string;
  /** Tick the in-process queue on a timer (mock mode in a real process). */
  pump?: boolean;
  ports?: Ports;
  api?: YouCamApi;
  download?: Downloader;
  /**
   * Checks who is calling the queue-delivery endpoint. Live, Cloud Tasks signs requests with a
   * Google OIDC token that this service must verify itself, because `mira-web` is the public
   * front door (HANDOFF, Phase 3 requirements). That verifier is not built, so the default for
   * live mode refuses everything.
   */
  authenticateQueue?: (headers: Record<string, string | string[] | undefined>) => Promise<boolean>;
}

export interface WorkflowsContext extends ServiceContext {
  readonly engine: Engine;
  readonly ports: Ports;
}

const fetchDownloader: Downloader = async (url) => {
  try {
    const res = await fetch(url);
    if (!res.ok)
      return { ok: false, error: { message: `download answered ${String(res.status)}` } };
    return {
      ok: true,
      value: {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: { message: error instanceof Error ? error.message : "download failed" },
    };
  }
};

/** mira-workflows: graph runner, node lifecycle, unit ledger and result cache. */
export function buildApp(
  source?: CreateServiceOptions["source"],
  options: WorkflowsOptions = {},
): WorkflowsContext {
  const ctx = createService({ service: "workflows", ...(source ? { source } : {}) });
  const { app, env, logger } = ctx;
  const mock = env.MIRA_MODE === "mock";

  if (!mock && !options.ports) {
    throw new Error(
      "Live adapters (Firestore, Cloud Tasks, Pub/Sub, Cloud Storage) are not built yet. Run with MIRA_MODE=mock, or finish phases/PHASE_01 first.",
    );
  }
  const ports = options.ports ?? createMockPorts(options.dataDir ? { dir: options.dataDir } : {});
  const fake = new FakeYouCam({ clock: ports.clock, prices: DEMO_PRICES });
  seedDemoFake(fake);
  const api: YouCamApi =
    options.api ??
    (mock
      ? fake
      : new HttpYouCamApi({
          apiKey: env.YOUCAM_API_KEY ?? "",
          ...(env.YOUCAM_API_BASE_URL ? { baseUrl: env.YOUCAM_API_BASE_URL } : {}),
        }));
  const engine = createEngine({
    ports,
    api,
    download: options.download ?? fetchDownloader,
    engineVersion: ENGINE_VERSION,
    executors: demoExecutors,
    log: (message, fields) => {
      logger.info(fields ?? {}, message);
    },
  });
  if (options.pump) {
    ports.queue.start(250);
    app.addHook("onClose", () => {
      ports.queue.stop();
    });
  }

  const allow = options.authenticateQueue ?? (() => Promise.resolve(mock));

  // ---- queue delivery (Cloud Tasks live; the in-process queue calls the runner directly) ----
  app.post("/internal/tasks/:queue", async (req, reply) => {
    if (!(await allow(req.headers)))
      return await reply.status(403).send({ error: "forbidden", traceId: req.traceId });
    const item = WorkItem.safeParse(req.body);
    if (!item.success)
      return await reply.status(400).send({ error: "invalid_work_item", traceId: req.traceId });
    const queue = z
      .enum(["youcam-submit", "youcam-poll", "engine-jobs"])
      .safeParse((req.params as { queue: string }).queue);
    if (!queue.success)
      return await reply.status(404).send({ error: "unknown_queue", traceId: req.traceId });
    await engine.runner.handle({ queue: queue.data, payload: item.data, attempt: 1 });
    return await reply.status(204).send();
  });

  // ---- webhook, forwarded by mira-webhook ----
  app.post("/internal/webhook", async (req) => {
    const body = z
      .object({ taskId: z.string().min(1), webhookId: z.string().min(1) })
      .parse(req.body);
    return { known: await engine.runner.lifecycle.pollNow(body.taskId, body.webhookId) };
  });

  // ---- reads, for the run viewer ----
  app.get("/internal/runs/:runId", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = await getDoc(ports.state, `runs/${runId}`, Run);
    if (!run) return await reply.status(404).send({ error: "run_not_found", traceId: req.traceId });
    const nodes = (await listDocs(ports.state, `runs/${runId}/nodes`, RunNode)).map((n) => n.value);
    const ledger = await engine.ledger.entries(runId);
    return { run, nodes, ledger, synthetic: mock && options.api === undefined };
  });

  app.get("/internal/runs/:runId/events", (req, reply) => {
    const { runId } = req.params as { runId: string };
    void reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const off = subscribe(ports.events, runId, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    req.raw.on("close", off);
  });

  app.post("/internal/runs/:runId/cancel", async (req) => {
    const { runId } = req.params as { runId: string };
    await engine.runner.cancel(runId);
    return { ok: true };
  });

  // ---- the demo graph (mock only: it uses a synthetic YouCam) ----
  const demo = newDemoSession();
  app.post("/internal/runs/demo", async (req, reply) => {
    if (!mock) return await reply.status(404).send({ error: "not_found", traceId: req.traceId });
    const started = await startDemoRun(engine, ports, demo);
    if (!started.ok)
      return await reply
        .status(422)
        .send({ error: "demo_failed", detail: started.error, traceId: req.traceId });
    return await reply.status(201).send(started.value);
  });

  return Object.assign(ctx, { engine, ports });
}

function subscribe(bus: EventBus, runId: string, send: (event: unknown) => void): () => void {
  return bus.subscribe(RUN_EVENTS_TOPIC, (event) => {
    if ((event as { runId?: string }).runId === runId) send(event);
  });
}
