import { loadCataloguePage } from "@mira/fixtures";
import { createService, type CreateServiceOptions, type ServiceContext } from "@mira/runtime";
import { AskRequest, SessionId, UserId } from "@mira/schemas";
import { z } from "zod";
import { fetchImage, fetchPage, type ImageResult, type PageResult } from "./extract/safe-fetch";
import { readGarmentPage } from "./extract/garment";
import { extractShadeRange, type ShadeReader } from "./extract/shade-range";
import { runAsk } from "./loop";
import { MockDiscovery, McpDiscovery, type LookDiscovery } from "./mcp/youcam";
import { narrateRun } from "./narrate";
import { MemoryPlanStore, type PlanStore } from "./plans";
import { placeholderPng } from "@mira/fixtures/placeholder";
import { selectProvider } from "./providers/select";
import type { MockScript } from "./providers/mock";
import type { ModelProvider } from "./providers/types";
import { startPlan, type ToolEnv } from "./tools";
import { httpWorkflows, type Workflows } from "./workflows";

export interface AgentDeps {
  /** Injected in tests; the real one refuses private addresses (extract/safe-fetch.ts). */
  fetchPage?: (url: string) => Promise<PageResult>;
  fetchImage?: (url: string) => Promise<ImageResult>;
  reader?: ShadeReader;
  /** Tests give the model, the workflows client and the plan store; the real ones come from env. */
  provider?: ModelProvider;
  script?: MockScript;
  workflows?: Workflows;
  plans?: PlanStore;
  discovery?: LookDiscovery;
  now?: () => Date;
}

/** mira-agent: Agent loop, tools, structured output, number injection, claim linter. */
export function buildApp(
  source?: CreateServiceOptions["source"],
  deps: AgentDeps = {},
): ServiceContext {
  const ctx = createService({ service: "agent", ...(source ? { source } : {}) });
  const { app, env } = ctx;
  const mock = env.MIRA_MODE === "mock";
  const get = deps.fetchPage ?? fetchPage;

  // ---- Ask MIRA ----------------------------------------------------------------------------
  const provider = deps.provider ?? selectProvider(env, deps.script);
  const workflows =
    deps.workflows ?? httpWorkflows(env.MIRA_WORKFLOWS_URL, { live: env.MIRA_MODE === "live" });
  const plans = deps.plans ?? new MemoryPlanStore();
  const discovery =
    deps.discovery ??
    (mock || !env.YOUCAM_API_KEY ? new MockDiscovery() : new McpDiscovery(env.YOUCAM_API_KEY));
  const tools: ToolEnv = {
    workflows,
    plans,
    discovery,
    provider,
    now: deps.now ?? (() => new Date()),
    page: {
      mock,
      provider,
      ...(deps.fetchPage ? { fetchPage: deps.fetchPage } : {}),
      ...(deps.reader ? { reader: deps.reader } : {}),
    },
  };

  app.post("/internal/agent/ask", async (req, reply) => {
    const body = AskRequest.safeParse(req.body);
    if (!body.success)
      return await reply.status(400).send({ error: "invalid_body", traceId: req.traceId });
    return { ...(await runAsk(body.data, tools)), traceId: req.traceId };
  });

  // The web app calls this when the person presses Confirm on the quote. It is the only place a
  // plan becomes confirmed, and it starts the plan at once.
  app.post("/internal/agent/plans/:planId/confirm", async (req, reply) => {
    const { planId } = req.params as { planId: string };
    const body = z.object({ userId: UserId, sessionId: SessionId }).safeParse(req.body);
    if (!body.success)
      return await reply.status(400).send({ error: "invalid_body", traceId: req.traceId });
    const confirmed = plans.confirm(planId, body.data.userId, body.data.sessionId, tools.now());
    if (!confirmed) {
      return await reply.status(404).send({ error: "unknown_plan", traceId: req.traceId });
    }
    const started = await startPlan(tools, body.data.userId, body.data.sessionId, planId);
    return await reply.status(started.status === "started" ? 201 : 409).send(started);
  });

  app.post("/internal/agent/narrate", async (req, reply) => {
    const body = z.object({ userId: UserId, runId: z.string().min(1).max(80) }).safeParse(req.body);
    if (!body.success)
      return await reply.status(400).send({ error: "invalid_body", traceId: req.traceId });
    return await narrateRun(
      { workflows, provider, now: tools.now },
      body.data.userId,
      body.data.runId,
    );
  });

  /**
   * Reads a shade range from a product page. In mock mode `fixture:<name>` names a saved page, so
   * the screens can be exercised with no network (D25); a real address is fetched either way.
   */
  app.post("/internal/extract/shade-range", async (req, reply) => {
    const body = z.object({ url: z.string().min(1).max(2_000) }).safeParse(req.body);
    if (!body.success)
      return await reply.status(400).send({ error: "invalid_body", traceId: req.traceId });
    const { url } = body.data;

    let page: PageResult;
    const fixture = /^fixture:([a-z0-9-]{1,64})$/.exec(url)?.[1];
    if (fixture !== undefined) {
      const html = mock ? loadCataloguePage(fixture) : undefined;
      page =
        html === undefined
          ? { ok: false, reason: "fetch_failed" }
          : { ok: true, html, finalUrl: url };
    } else {
      page = await get(url);
    }
    if (!page.ok) {
      const status = page.reason === "fetch_failed" ? 502 : 422;
      return await reply.status(status).send({ error: page.reason, traceId: req.traceId });
    }
    const read = await extractShadeRange(page.html, { url: page.finalUrl }, deps.reader);
    if (!read.ok) {
      return await reply.status(422).send({ error: read.reason, traceId: req.traceId });
    }
    return { range: read.range };
  });

  /**
   * Reads a garment from a product page: its title and its picture. The picture is fetched with
   * the same guards as a page and held for the person in the workflows service, which prices and
   * runs the colour reading (a quote first, like any spend). In mock mode `fixture:<name>` names a
   * saved page and the picture is a drawn stand-in.
   */
  app.post("/internal/extract/garment", async (req, reply) => {
    const body = z
      .object({ url: z.string().min(1).max(2_000), userId: UserId })
      .safeParse(req.body);
    if (!body.success)
      return await reply.status(400).send({ error: "invalid_body", traceId: req.traceId });
    const fixture = /^fixture:([a-z0-9-]{1,64})$/.exec(body.data.url)?.[1];
    const page =
      fixture === undefined
        ? await get(body.data.url)
        : mock && loadCataloguePage(fixture) !== undefined
          ? {
              ok: true as const,
              html: loadCataloguePage(fixture) ?? "",
              finalUrl: "https://shop.example/p",
            }
          : { ok: false as const, reason: "fetch_failed" as const };
    if (!page.ok) {
      return await reply
        .status(page.reason === "fetch_failed" ? 502 : 422)
        .send({ error: page.reason, traceId: req.traceId });
    }
    const garment = readGarmentPage(page.html, page.finalUrl);
    if (!garment) {
      return await reply.status(422).send({ error: "garment_not_readable", traceId: req.traceId });
    }
    const picture =
      fixture === undefined
        ? await (deps.fetchImage ?? fetchImage)(garment.image)
        : {
            ok: true as const,
            bytes: placeholderPng({ hex: "#9E1F2D" }),
            contentType: "image/png" as const,
            finalUrl: garment.image,
          };
    if (!picture.ok) {
      return await reply
        .status(picture.reason === "fetch_failed" ? 502 : 422)
        .send({ error: picture.reason, traceId: req.traceId });
    }
    const up = await workflows.postBytes(
      `/internal/uploads?userId=${body.data.userId}&kind=garment`,
      picture.bytes,
      picture.contentType,
    );
    const key = up.ok && up.status === 201 ? (up.body as { key?: unknown } | null)?.key : undefined;
    if (typeof key !== "string") {
      return await reply.status(502).send({ error: "upload_failed", traceId: req.traceId });
    }
    return { photo: key, name: garment.name };
  });

  // Venue presets for Look Studio, discovered through the YouCam MCP server (the same
  // discovery-only path as the agent's `list_backgrounds` tool).
  app.get("/internal/look/backgrounds", async (req, reply) => {
    const q = z.object({ venue: z.string().regex(/^[a-z]{2,20}$/) }).safeParse(req.query);
    if (!q.success)
      return await reply.status(400).send({ error: "invalid_query", traceId: req.traceId });
    const found = await discovery.backgrounds(q.data.venue);
    return { items: found.ok ? found.items : [] };
  });

  return ctx;
}
