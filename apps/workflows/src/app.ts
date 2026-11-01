import {
  createService,
  Identity,
  createMockPorts,
  type CreateServiceOptions,
  type Ports,
  type ServiceContext,
  type EventBus,
} from "@mira/runtime";
import {
  Run,
  RunNode,
  ShadeRange,
  SessionId,
  Twin,
  TwinGroupName,
  UserId,
  WorkItem,
  newId,
} from "@mira/schemas";
import { getDoc, listDocs } from "@mira/runtime";
import { ReplayYouCam, type YouCamApi } from "@mira/youcam-client";
import { fixtureDownloader, hasRecordings, loadCatalogues, loadFixtures } from "@mira/fixtures";
import { FakeYouCam } from "@mira/youcam-client/testing";
import { z } from "zod";
import { DEMO_PRICES, demoExecutors, newDemoSession, seedDemoFake, startDemoRun } from "./demo";
import { createEngine, type Engine } from "./engine";
import { createShadeExecutors } from "./graphs/match-shade";
import { planShadeMatch, type ShadeBuildError } from "./shade/build";
import { planShade } from "./shade/plan";
import { seedShadeFake, syntheticDownloader } from "./shade/synthetic";
import { cleanupRun } from "./runner/cleanup";
import { createTwinExecutors } from "./graphs/build-twin";
import { planTwinBuild, type BuildError } from "./twin/build";
import { HttpEngineClient, type EngineClient } from "./twin/engine-client";
import { deleteProfile, exportProfile, inventory, uploadsPrefix } from "./twin/profile";
import { seedTwinFake } from "./twin/synthetic";
import {
  UPLOAD_LIMITS,
  UploadKind,
  checkUpload,
  forgetUpload,
  recordUpload,
  sweepUploads,
} from "./twin/uploads";
import { fetchDownloader } from "./lifecycle/download";
import { liveYouCam } from "./lifecycle/live-api";
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
  /** The measurement engines. Defaults to HTTP against `MIRA_ENGINES_URL`. */
  engineClient?: EngineClient;
}

export interface WorkflowsContext extends ServiceContext {
  readonly engine: Engine;
  readonly ports: Ports;
}

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
  // Mock mode quotes with the real price list read from YouCam on 2026-11-01 (D26); the demo's
  // three features are priced by the same list. Without a snapshot it falls back to DEMO_PRICES.
  const snapshot = loadFixtures().skus;
  const fake = new FakeYouCam({
    clock: ports.clock,
    ...(snapshot.length > 0 ? { skus: snapshot } : { prices: DEMO_PRICES }),
  });
  seedDemoFake(fake);
  seedTwinFake(fake);
  seedShadeFake(fake);
  // With real recordings on disk (MIRA_FIXTURES=recorded) mock mode replays them; with none it
  // says so and shows the synthetic demo instead. It never pretends the demo is a recording.
  const replaying = mock && process.env.MIRA_FIXTURES === "recorded" && hasRecordings();
  const loaded = replaying ? loadFixtures() : undefined;
  const api: YouCamApi =
    options.api ??
    (loaded
      ? new ReplayYouCam({ clock: ports.clock, fixtures: loaded.fixtures, skus: loaded.skus })
      : mock
        ? fake
        : liveYouCam(
            { apiKey: env.YOUCAM_API_KEY ?? "", baseUrl: env.YOUCAM_API_BASE_URL },
            ports.clock,
          ).api);
  const identity = new Identity();
  const synthetic = mock && options.api === undefined && !replaying;
  const engines: EngineClient =
    options.engineClient ??
    new HttpEngineClient({
      baseUrl: env.MIRA_ENGINES_URL,
      // The engines are a private Cloud Run service: live, a call needs an ID token for it.
      headers: () => (mock ? Promise.resolve({}) : identity.headers(env.MIRA_ENGINES_URL)),
    });
  const engine = createEngine({
    ports,
    api,
    download:
      options.download ??
      (replaying
        ? fixtureDownloader()
        : mock && options.api === undefined
          ? // Synthetic renders have no real image to fetch: they get the placeholder picture.
            syntheticDownloader(fake, fetchDownloader)
          : fetchDownloader),
    engineVersion: ENGINE_VERSION,
    executors: {
      ...demoExecutors,
      ...createTwinExecutors({ ports, engine: engines, synthetic }),
      ...createShadeExecutors({ engine: engines }),
    },
    caps: {
      session: env.MIRA_SESSION_UNIT_CAP,
      // Mock mode shares one server between many test runs, so the daily cap applies only if asked.
      ...(!mock || process.env.MIRA_DEPLOYMENT_DAILY_UNIT_CAP
        ? { deploymentDaily: env.MIRA_DEPLOYMENT_DAILY_UNIT_CAP }
        : {}),
    },
    log: (message, fields) => {
      logger.info(fields ?? {}, message);
    },
  });
  // Pick up runs that were in flight when the process last stopped (file-backed state, D10).
  void engine.runner.recover().then((r) => {
    if (r.runs + r.cleanups > 0) logger.info(r, "recovered runs after restart");
  });
  if (options.pump) {
    ports.queue.start(250);
    // Photos that waited for a run are deleted after the held time, even if nobody comes back.
    const sweep = () => {
      void sweepUploads(ports).then((r) => {
        if (r.deleted > 0) logger.info(r, "deleted held photos past their time");
      });
    };
    sweep();
    const sweeper = setInterval(sweep, 5 * 60_000);
    sweeper.unref();
    app.addHook("onClose", () => {
      clearInterval(sweeper);
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
  app.post("/internal/webhook", async (req, reply) => {
    const body = z
      .object({ taskId: z.string().min(1), webhookId: z.string().min(1) })
      .safeParse(req.body);
    if (!body.success)
      return await reply.status(400).send({ error: "invalid_body", traceId: req.traceId });
    return { known: await engine.runner.lifecycle.pollNow(body.data.taskId, body.data.webhookId) };
  });

  // ---- reads, for the run viewer ----
  app.get("/internal/runs/:runId", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = await getDoc(ports.state, `runs/${runId}`, Run);
    if (!run) return await reply.status(404).send({ error: "run_not_found", traceId: req.traceId });
    const nodes = (await listDocs(ports.state, `runs/${runId}/nodes`, RunNode)).map((n) => n.value);
    const ledger = await engine.ledger.entries(runId);
    return { run, nodes, ledger, synthetic };
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

  // ---- keep a look: copies its images out of the run before cleanup deletes them ----
  app.post("/internal/runs/:runId/save", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const body = z
      .object({ nodeIds: z.array(z.string().min(1)).min(1).max(20) })
      .safeParse(req.body);
    if (!body.success)
      return await reply.status(400).send({ error: "invalid_body", traceId: req.traceId });
    const saved = await engine.runner.save(runId, body.data.nodeIds);
    if (!saved.ok) {
      const status = saved.error.code === "run_not_found" ? 404 : 409;
      return await reply.status(status).send({ error: saved.error.code, traceId: req.traceId });
    }
    return await reply.status(201).send(saved.value);
  });

  app.post("/internal/runs/:runId/cancel", async (req) => {
    const { runId } = req.params as { runId: string };
    await engine.runner.cancel(runId);
    return { ok: true };
  });

  // ---- the session's unit budget, for the shell's banner (docs/UX_FLOWS.md §0) ----
  app.get("/internal/budgets/:sessionId", async (req, reply) => {
    const id = SessionId.safeParse((req.params as { sessionId: string }).sessionId);
    if (!id.success) {
      return await reply.status(400).send({ error: "invalid_session", traceId: req.traceId });
    }
    const b = await engine.ledger.budget(id.data);
    const cap = await engine.ledger.sessionCap(id.data);
    return {
      cap,
      reserved: b.reserved,
      committed: b.committed,
      left: Math.max(0, cap - b.reserved - b.committed),
    };
  });

  // ---- uploads: the person's captures, held until the run that reads them ends ----
  // Raw image bytes in the body, so the browser sends a file as it is (no multipart parser).
  app.addContentTypeParser(/^image\/(jpeg|png)$/, { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });
  app.post("/internal/uploads", async (req, reply) => {
    const who = z.object({ userId: UserId, kind: UploadKind }).safeParse(req.query);
    if (!who.success)
      return await reply.status(400).send({ error: "invalid_upload_query", traceId: req.traceId });
    if (!Buffer.isBuffer(req.body)) {
      return await reply.status(415).send({ error: "unsupported_type", traceId: req.traceId });
    }
    const bytes = new Uint8Array(req.body);
    const checked = checkUpload(bytes);
    if (!checked.ok) {
      const status = checked.error.code === "unsupported_type" ? 415 : 422;
      return await reply
        .status(status)
        .send({ ...checked.error, error: checked.error.code, traceId: req.traceId });
    }
    const held = await ports.blobs.list(uploadsPrefix(who.data.userId));
    if (held.length >= UPLOAD_LIMITS.maxHeld) {
      return await reply.status(429).send({ error: "too_many_uploads", traceId: req.traceId });
    }
    const ext = checked.value.info.type === "image/png" ? "png" : "jpg";
    const key = `${uploadsPrefix(who.data.userId)}${newId("up")}.${ext}`;
    await ports.blobs.put(key, bytes, checked.value.info.type);
    await recordUpload(ports, {
      key,
      kind: who.data.kind,
      at: new Date(ports.clock.now()).toISOString(),
    });
    return await reply.status(201).send({
      key,
      width: checked.value.info.width,
      height: checked.value.info.height,
      bytes: checked.value.bytes,
      hdCapable: checked.value.hdCapable,
    });
  });
  app.delete("/internal/uploads", async (req, reply) => {
    const q = z.object({ userId: UserId, key: z.string().min(1) }).safeParse(req.query);
    if (!q.success || !q.data.key.startsWith(uploadsPrefix(q.data.userId)))
      return await reply.status(400).send({ error: "invalid_upload", traceId: req.traceId });
    await ports.blobs.delete(q.data.key);
    await forgetUpload(ports, q.data.key);
    return await reply.status(204).send();
  });

  const blobKey = z.string().min(1).max(200);
  // ---- Shade: ranges, the free pre-rank, quote, build, and the preview images ----
  const catalogues = loadCatalogues();
  app.get("/internal/shade/ranges", () => ({ ranges: catalogues }));
  const ShadeBody = z.object({
    userId: UserId,
    sessionId: SessionId,
    range: ShadeRange,
    photo: blobKey,
    topN: z.number().int().min(1).max(20).optional(),
    shadeIds: z.array(z.string().min(1)).min(1).max(5).optional(),
    removedShadeIds: z.array(z.string().min(1)).max(20).optional(),
    concealer: z.boolean().optional(),
    confirmedTotal: z.number().int().nonnegative().optional(),
  });
  const shadeStatus = (e: ShadeBuildError): number =>
    e.code === "upload_foreign"
      ? 400
      : e.code === "upload_missing" || e.code === "no_shades_chosen"
        ? 422
        : e.code === "plan_failed"
          ? e.detail.code === "engine_failed"
            ? 502
            : 409
          : e.code === "quote_failed"
            ? e.detail.code === "price_unavailable"
              ? 502
              : 422
            : e.code === "graph_rejected"
              ? 500
              : 409; // over the cap, a changed price, or a concealer that was not suggested
  // Ranking the whole range costs nothing, so it needs no photo and no quote.
  app.post("/internal/shade/prerank", async (req, reply) => {
    const body = z.object({ userId: UserId, range: ShadeRange }).safeParse(req.body);
    if (!body.success)
      return await reply.status(400).send({ error: "invalid_body", traceId: req.traceId });
    const plan = await planShade(ports, engines, body.data.userId, body.data.range);
    if (!plan.ok) {
      const status = plan.error.code === "engine_failed" ? 502 : 409;
      return await reply
        .status(status)
        .send({ ...plan.error, error: plan.error.code, traceId: req.traceId });
    }
    return plan.value;
  });
  for (const start of [false, true]) {
    app.post(start ? "/internal/shade/build" : "/internal/shade/quote", async (req, reply) => {
      const body = ShadeBody.safeParse(req.body);
      if (!body.success)
        return await reply.status(400).send({ error: "invalid_body", traceId: req.traceId });
      if (start && body.data.confirmedTotal === undefined) {
        return await reply
          .status(400)
          .send({ error: "confirmed_total_required", traceId: req.traceId });
      }
      const planned = await planShadeMatch(engine, ports, engines, body.data, start);
      if (!planned.ok) {
        return await reply
          .status(shadeStatus(planned.error))
          .send({ ...planned.error, error: planned.error.code, traceId: req.traceId });
      }
      const { plan, ...rest } = planned.value;
      return await reply.status(start ? 201 : 200).send({
        ...rest,
        finish: plan.finish,
        coverage: plan.coverage,
        synthetic,
      });
    });
  }
  // A preview image while the run's review window is open (it is deleted when the window closes).
  app.get("/internal/runs/:runId/images/:nodeId", async (req, reply) => {
    const { runId, nodeId } = req.params as { runId: string; nodeId: string };
    const node = await getDoc(ports.state, `runs/${runId}/nodes/${nodeId}`, RunNode);
    const blob = node?.resultRef === undefined ? undefined : await ports.blobs.get(node.resultRef);
    if (!blob) return await reply.status(404).send({ error: "image_gone", traceId: req.traceId });
    return await reply
      .header("content-type", blob.contentType)
      .header("cache-control", "no-store")
      .send(Buffer.from(blob.bytes));
  });

  // ---- the Twin: quote, build, read, download, delete ----
  const BuildBody = z.object({
    userId: UserId,
    sessionId: SessionId,
    capture: z.object({
      face: blobKey,
      repeats: z.array(blobKey).max(2).optional(),
      hair: z
        .object({ front: blobKey, right: blobKey.optional(), left: blobKey.optional() })
        .optional(),
      mode: z.enum(["hd", "sd"]),
      source: z.enum(["camera", "upload"]),
      qualityChecksPassed: z.boolean().nullable(),
      only: z.array(TwinGroupName).min(1).optional(),
    }),
    removed: z.array(z.string().min(1)).max(20).optional(),
    confirmedTotal: z.number().int().nonnegative().optional(),
  });
  const buildStatus = (e: BuildError): number =>
    e.code === "upload_foreign"
      ? 400
      : e.code === "upload_missing" || e.code === "repeat_duplicate"
        ? 422
        : e.code === "quote_failed"
          ? e.detail.code === "price_unavailable"
            ? 502
            : 422
          : e.code === "graph_rejected"
            ? 500
            : 409;
  for (const start of [false, true]) {
    app.post(start ? "/internal/twin/build" : "/internal/twin/quote", async (req, reply) => {
      const body = BuildBody.safeParse(req.body);
      if (!body.success)
        return await reply.status(400).send({ error: "invalid_body", traceId: req.traceId });
      // Spending needs the price the person saw. A request with no confirmed total never starts.
      if (start && body.data.confirmedTotal === undefined) {
        return await reply
          .status(400)
          .send({ error: "confirmed_total_required", traceId: req.traceId });
      }
      const planned = await planTwinBuild(engine, ports, body.data, start);
      if (!planned.ok) {
        return await reply
          .status(buildStatus(planned.error))
          .send({ ...planned.error, error: planned.error.code, traceId: req.traceId });
      }
      return await reply.status(start ? 201 : 200).send({ ...planned.value, synthetic });
    });
  }
  const userParam = (req: { params: unknown }) =>
    UserId.safeParse((req.params as { userId: string }).userId);
  app.get("/internal/twin/:userId", async (req, reply) => {
    const id = userParam(req);
    if (!id.success)
      return await reply.status(400).send({ error: "invalid_user", traceId: req.traceId });
    const inv = await inventory(ports, id.data);
    if (!inv.twin)
      return await reply
        .status(404)
        .send({ error: "no_profile", deletions: inv.deletions, traceId: req.traceId });
    return { twin: inv.twin, synthetic: inv.twin.synthetic };
  });
  app.get("/internal/twin/:userId/inventory", async (req, reply) => {
    const id = userParam(req);
    if (!id.success)
      return await reply.status(400).send({ error: "invalid_user", traceId: req.traceId });
    return await inventory(ports, id.data);
  });
  app.get("/internal/twin/:userId/export", async (req, reply) => {
    const id = userParam(req);
    if (!id.success)
      return await reply.status(400).send({ error: "invalid_user", traceId: req.traceId });
    return await exportProfile(ports, id.data);
  });
  app.delete("/internal/twin/:userId", async (req, reply) => {
    const id = userParam(req);
    if (!id.success)
      return await reply.status(400).send({ error: "invalid_user", traceId: req.traceId });
    const deleted = await deleteProfile(ports, id.data, {
      cleanupRun: async (runId) => (await cleanupRun(engine.deps, runId, 0)).tasksPending === 0,
    });
    if (!deleted.ok)
      return await reply
        .status(409)
        .send({ ...deleted.error, error: deleted.error.code, traceId: req.traceId });
    return deleted.value;
  });

  // ---- mock only: lets a test give one session its own unit cap, so suites that need a larger
  // budget do not change the default cap other tests rely on. Absent in live mode. ----
  if (mock) {
    app.post("/internal/dev/session-cap", async (req, reply) => {
      const body = z
        .object({ sessionId: SessionId, cap: z.number().int().min(0).max(100_000) })
        .safeParse(req.body);
      if (!body.success)
        return await reply.status(400).send({ error: "invalid_body", traceId: req.traceId });
      await engine.ledger.setSessionCap(body.data.sessionId, body.data.cap);
      return { ok: true };
    });
    // Writes a profile as given, so a test can show every state of the profile screen without
    // arranging for YouCam to fail in just the right way. The body is checked as a real Twin.
    app.post("/internal/dev/twin", async (req, reply) => {
      const body = Twin.safeParse(req.body);
      if (!body.success)
        return await reply.status(400).send({ error: "invalid_twin", traceId: req.traceId });
      await ports.state.set(`twins/${body.data.userId}`, body.data);
      return await reply.status(201).send({ ok: true });
    });
  }

  // ---- the demo graph (mock only: it uses a synthetic YouCam) ----
  const fallbackSession = newDemoSession();
  app.post("/internal/runs/demo", async (req, reply) => {
    if (!mock || replaying)
      return await reply.status(404).send({ error: "not_found", traceId: req.traceId });
    // The person's own session, so the demo spends from (and shows) their budget.
    const who = z.object({ userId: UserId, sessionId: SessionId }).safeParse(req.body ?? {});
    const tag = z.object({ tag: z.string().regex(/^[a-z0-9-]{1,32}$/) }).safeParse(req.body ?? {});
    const started = await startDemoRun(
      engine,
      ports,
      who.success ? { userId: who.data.userId, sessionId: who.data.sessionId } : fallbackSession,
      tag.success ? tag.data.tag : undefined,
    );
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
