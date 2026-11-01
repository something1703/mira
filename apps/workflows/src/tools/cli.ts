import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { basename, extname, join } from "node:path";
import { createMockPorts, type Ports } from "@mira/runtime";
import { Run, RunNode, newId, type Quote, type RunEvent } from "@mira/schemas";
import { COST_SNAPSHOT_FILE, FEATURES, type YouCamApi } from "@mira/youcam-client";
import { RECORDED_DIR } from "@mira/fixtures";
import { createEngine, type Engine } from "../engine";
import { fetchDownloader } from "../lifecycle/download";
import { liveYouCam } from "../lifecycle/live-api";
import type { Downloader } from "../lifecycle/types";
import { buildQuote } from "../quote";
import type { GraphSpec } from "../runner/graph";
import { RecordingApi, parseRecordArgs, recordGraph, toFixture } from "./record";

/** What the CLIs need from the outside world, so tests can replace all of it. */
export interface CliDeps {
  /** The real API when `YOUCAM_API_KEY` is set; tests pass a fake. */
  api?: YouCamApi;
  ports?: Ports;
  download?: Downloader;
  /** Asks the person. Must answer false unless they said yes. */
  confirm?: (question: string) => Promise<boolean>;
  out?: (line: string) => void;
  recordedDir?: string;
  readFile?: (path: string) => Uint8Array;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};
const FINISHED = new Set(["succeeded", "failed", "partial", "cancelled"]);

/** Asks on the terminal. No terminal, or anything but y or yes, is a no: nothing is ever spent by default. */
export async function askOnTerminal(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

function setup(deps: CliDeps) {
  const out = deps.out ?? ((line: string) => void process.stdout.write(`${line}\n`));
  let key: string | undefined;
  if (!deps.api) {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // No .env.local: the key may already be in the environment.
    }
    key = process.env.YOUCAM_API_KEY;
    if (!key) {
      return {
        error: "YOUCAM_API_KEY is not set. Put it in .env.local (never in chat or git).",
      } as const;
    }
  }
  const ports = deps.ports ?? createMockPorts({ dir: ".mira/live" });
  // The CLIs run on the in-process queue, which has no rate limit of its own, so the client's
  // limiter is what keeps them under YouCam's 250 requests per 300 s.
  const api: YouCamApi =
    deps.api ??
    liveYouCam({ apiKey: key ?? "", baseUrl: process.env.YOUCAM_API_BASE_URL }, ports.clock).api;
  return {
    out,
    api,
    ports,
    confirm: deps.confirm ?? askOnTerminal,
    sleep: deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
  } as const;
}

async function runToEnd(
  engine: Engine,
  ports: Ports,
  runId: string,
  sleep: (ms: number) => Promise<void>,
  timeoutMs = 15 * 60_000,
): Promise<Run> {
  const started = ports.clock.now();
  for (;;) {
    await ports.queue.tick();
    const run = Run.parse(await ports.state.get(`runs/${runId}`));
    if (FINISHED.has(run.status) && run.cleanedAt !== undefined) return run;
    if (ports.clock.now() - started > timeoutMs) throw new Error("The run did not finish in time");
    await sleep(500);
  }
}

function printQuote(out: (l: string) => void, quote: Quote, balance: number | undefined) {
  out("Quote (prices read from YouCam's feature-cost endpoint):");
  for (const l of quote.lines)
    out(
      `  ${l.feature.padEnd(30)} ${String(l.units).padStart(4)} units${l.cached ? "  (saved result)" : ""}`,
    );
  out(`  ${"total".padEnd(30)} ${String(quote.total).padStart(4)} units`);
  if (balance !== undefined) out(`  balance now: ${String(balance)} units`);
}

/** `pnpm fixtures:record <feature> --input <image> --params <json> [--name n] [--ref image]` */
export async function recordMain(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
  const args = parseRecordArgs(argv);
  const env = setup(deps);
  if ("error" in env) {
    process.stderr.write(`${env.error}\n`);
    return 2;
  }
  const { out, api, ports, confirm, sleep } = env;
  if (!args.ok) {
    out(args.error);
    return 2;
  }
  const feature = FEATURES[args.value.feature];
  if (!feature.params.safeParse(args.value.params).success) {
    out(`The --params do not match ${args.value.feature}'s parameters.`);
    return 2;
  }

  const read = deps.readFile ?? ((p: string) => readFileSync(p));
  const keyFor = (path: string) => `runs/record/${basename(path)}`;
  const files = [args.value.input, ...(args.value.ref ? [args.value.ref] : [])];
  for (const path of files) {
    const type = MIME[extname(path).toLowerCase()];
    if (!type) {
      out(`${path}: only .jpg, .jpeg and .png are accepted.`);
      return 2;
    }
    const bytes = read(path);
    if (bytes.byteLength > 10 * 1024 * 1024) {
      out(`${path} is larger than YouCam's 10 MB limit.`);
      return 2;
    }
    await ports.blobs.put(keyFor(path), bytes, type);
  }

  const recorder = new RecordingApi(api, () => ports.clock.now());
  const resultBytes = new Map<string, Uint8Array>();
  ports.events.subscribe("run-events", async (e) => {
    const ev = e as RunEvent;
    if (ev.type !== "node_done") return;
    const node = RunNode.parse(await ports.state.get(`runs/${ev.runId}/nodes/${ev.nodeId ?? ""}`));
    // Copy the result out now: the run's images are deleted when it ends.
    const blob = node.resultRef ? await ports.blobs.get(node.resultRef) : undefined;
    if (blob && node.resultUrl) resultBytes.set(node.resultUrl, blob.bytes);
  });
  const engine = createEngine({
    ports,
    api: recorder,
    engineVersion: "record",
    download: deps.download ?? fetchDownloader,
  });

  const graph: GraphSpec = recordGraph(
    args.value,
    keyFor(args.value.input),
    args.value.ref ? keyFor(args.value.ref) : undefined,
  );
  const sessionId = newId("ses");
  const quote = await buildQuote({
    graph,
    sessionId,
    costs: engine.costs,
    ledger: engine.ledger,
    now: () => ports.clock.now(),
  });
  if (!quote.ok) {
    out(`Cannot quote this recording: ${quote.error.message}`);
    return 1;
  }
  const balance = await api.getCredit(ports.clock.now());
  printQuote(out, quote.value, balance.ok ? balance.value.units : undefined);
  if (
    !(await confirm(
      `Spend up to ${String(quote.value.total)} units recording ${args.value.feature}?`,
    ))
  ) {
    out("Cancelled. Nothing was submitted and no units were used.");
    return 0;
  }

  const prices = await engine.costs.get();
  const started = await engine.runner.startRun({
    graph,
    userId: newId("usr"),
    sessionId,
    planId: newId("plan"),
    quote: quote.value,
    recorded: false,
  });
  if (!started.ok) {
    out(`The graph was rejected: ${started.error.code}`);
    return 1;
  }
  const run = await runToEnd(engine, ports, started.value.id, sleep);
  const cap = [...recorder.captures.values()][0];
  if (!cap?.outcome) {
    out(`The run ${run.status} before YouCam answered. No fixture was written.`);
    return 1;
  }

  const { fixture, urls } = toFixture(cap, {
    name: args.value.name,
    unitsCharged: run.unitsSpent,
    recordedAt: new Date(ports.clock.now()).toISOString(),
  });
  const root = deps.recordedDir ?? RECORDED_DIR;
  const folder = join(root, fixture.feature);
  mkdirSync(join(folder, "files"), { recursive: true });
  for (const [ref, original] of Object.entries(urls)) {
    const bytes = resultBytes.get(original);
    if (bytes) writeFileSync(join(folder, "files", ref.slice("fixture://".length)), bytes);
  }
  writeFileSync(join(folder, `${fixture.name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
  if (prices.ok) {
    writeFileSync(
      join(root, COST_SNAPSHOT_FILE),
      `${JSON.stringify(
        prices.value.map((s) => ({
          slug: s.slug,
          amount: s.amount,
          ...(s.description ? { description: s.description } : {}),
          ...(s.unit ? { unit: s.unit } : {}),
        })),
        null,
        2,
      )}\n`,
    );
  }
  out(
    `Recorded ${fixture.feature}/${fixture.name}: ${fixture.outcome.status}, ${String(fixture.unitsCharged)} units, ${String(Math.round(fixture.latencyMs))} ms.`,
  );
  out(
    "The input photo was not stored. If a result image shows a real face, add a row to packages/fixtures/CONSENT.md before committing.",
  );
  return 0;
}

/** The cheapest valid call per feature MIRA uses with one photo. Prices still come from feature-cost. */
export const SMOKE_CASES: readonly {
  feature: keyof typeof FEATURES;
  params: Record<string, unknown>;
}[] = [
  { feature: "skin-tone-analysis", params: {} },
  { feature: "fitzpatrick-scale-analyzer", params: {} },
  { feature: "face-attr-analysis", params: { features: ["faceAspectRatio"] } },
  { feature: "hair-density-detection", params: {} },
  { feature: "hair-length-detection", params: {} },
  { feature: "skin-analysis", params: { concerns: ["pore"] } },
  { feature: "skin-simulation", params: { pores: 0.5 } },
  { feature: "sod", params: {} },
];

/** `pnpm smoke:live --input <image>`: one tiny job per feature, after a quote and a confirmation. Never run in CI. */
export async function smokeMain(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
  const env = setup(deps);
  if ("error" in env) {
    process.stderr.write(`${env.error}\n`);
    return 2;
  }
  const { out, api, ports, confirm, sleep } = env;
  const input = argv[argv.indexOf("--input") + 1];
  if (argv.indexOf("--input") === -1 || !input) {
    out("--input <image file> is required.");
    return 2;
  }
  const type = MIME[extname(input).toLowerCase()];
  if (!type) {
    out("Only .jpg, .jpeg and .png are accepted.");
    return 2;
  }
  await ports.blobs.put(
    "runs/smoke/input",
    (deps.readFile ?? ((p: string) => readFileSync(p)))(input),
    type,
  );

  const engine = createEngine({
    ports,
    api,
    engineVersion: "smoke",
    download: deps.download ?? fetchDownloader,
  });
  const sessionId = newId("ses");
  const graphs = SMOKE_CASES.map((c): GraphSpec => ({
    type: "demo",
    nodes: [
      {
        id: "smoke",
        kind: "youcam",
        label: "step.smoke",
        feature: c.feature,
        params: c.params,
        inputs: { src: "blob:runs/smoke/input" },
      },
    ],
  }));
  let total = 0;
  const quotes: Quote[] = [];
  for (const [i, graph] of graphs.entries()) {
    const q = await buildQuote({
      graph,
      sessionId,
      costs: engine.costs,
      ledger: engine.ledger,
      now: () => ports.clock.now(),
    });
    if (!q.ok) {
      out(`Cannot quote ${SMOKE_CASES[i]?.feature ?? "?"}: ${q.error.message}`);
      return 1;
    }
    quotes.push(q.value);
    total += q.value.total;
    out(
      `  ${(SMOKE_CASES[i]?.feature ?? "").padEnd(30)} ${String(q.value.total).padStart(4)} units`,
    );
  }
  out(`  ${"total".padEnd(30)} ${String(total).padStart(4)} units`);
  if (!(await confirm(`Spend up to ${String(total)} units on a live smoke test?`))) {
    out("Cancelled. Nothing was submitted and no units were used.");
    return 0;
  }

  let failures = 0;
  for (const [i, graph] of graphs.entries()) {
    const quote = quotes[i];
    if (!quote) continue;
    const started = await engine.runner.startRun({
      graph,
      userId: newId("usr"),
      sessionId,
      planId: newId("plan"),
      quote,
      recorded: false,
    });
    if (!started.ok) {
      failures += 1;
      continue;
    }
    const run = await runToEnd(engine, ports, started.value.id, sleep);
    const node = RunNode.parse(await ports.state.get(`runs/${run.id}/nodes/smoke`));
    const pass = run.status === "succeeded";
    if (!pass) failures += 1;
    out(
      `${pass ? "PASS" : "FAIL"}  ${(SMOKE_CASES[i]?.feature ?? "").padEnd(30)} ${String(run.unitsSpent).padStart(4)} units${node.error ? `  ${node.error.code}` : ""}`,
    );
  }
  out(failures === 0 ? "All features answered." : `${String(failures)} feature(s) failed.`);
  return failures === 0 ? 0 : 1;
}
