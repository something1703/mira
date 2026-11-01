import { loadCataloguePage } from "@mira/fixtures";
import { createService, type CreateServiceOptions, type ServiceContext } from "@mira/runtime";
import { z } from "zod";
import { fetchPage, type PageResult } from "./extract/safe-fetch";
import { extractShadeRange, type ShadeReader } from "./extract/shade-range";

export interface AgentDeps {
  /** Injected in tests; the real one refuses private addresses (extract/safe-fetch.ts). */
  fetchPage?: (url: string) => Promise<PageResult>;
  reader?: ShadeReader;
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

  return ctx;
}
