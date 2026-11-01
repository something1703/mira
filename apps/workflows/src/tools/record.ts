import {
  FEATURES,
  bodyKey,
  scrubUrls,
  type CreditBalance,
  type Fixture,
  type FeatureSlug,
  type RegisteredFile,
  type Sku,
  type TaskState,
  type YouCamApi,
  type YouCamError,
} from "@mira/youcam-client";
import type { Result } from "@mira/schemas";
import type { GraphSpec } from "../runner/graph";

type Res<T> = Promise<Result<T, YouCamError>>;
type TaskRef = Pick<(typeof FEATURES)[FeatureSlug], "slug" | "version">;

interface Capture {
  feature: TaskRef;
  body: Record<string, unknown>;
  createdAt: number;
  outcome?:
    { status: "success"; results: unknown } | { status: "error"; error: string; message?: string };
  latencyMs?: number;
}

/**
 * Wraps a real `YouCamApi` and remembers each task it creates: the request body, how long until it
 * finished and what it returned. The recorder runs a normal graph through the node lifecycle on
 * top of this, so a recording is made the same way a real run is (AGENTS.md §2.2).
 */
export class RecordingApi implements YouCamApi {
  readonly captures = new Map<string, Capture>();

  constructor(
    private readonly inner: YouCamApi,
    private readonly now: () => number = Date.now,
  ) {}

  registerFile(input: Parameters<YouCamApi["registerFile"]>[0]): Res<RegisteredFile> {
    return this.inner.registerFile(input);
  }

  putBytes(file: RegisteredFile, bytes: Uint8Array): Res<void> {
    return this.inner.putBytes(file, bytes);
  }

  async createTask(feature: TaskRef, body: Record<string, unknown>): Res<{ taskId: string }> {
    const res = await this.inner.createTask(feature, body);
    if (res.ok) this.captures.set(res.value.taskId, { feature, body, createdAt: this.now() });
    return res;
  }

  async getTask(feature: TaskRef, taskId: string): Res<TaskState> {
    const res = await this.inner.getTask(feature, taskId);
    const cap = this.captures.get(taskId);
    if (res.ok && cap && cap.outcome === undefined) {
      if (res.value.status === "success") {
        cap.outcome = { status: "success", results: res.value.results };
        cap.latencyMs = this.now() - cap.createdAt;
      } else if (res.value.status === "error") {
        cap.outcome = {
          status: "error",
          error: res.value.error.upstream ?? res.value.error.code,
          message: res.value.error.message,
        };
        cap.latencyMs = this.now() - cap.createdAt;
      }
    }
    return res;
  }

  deleteTask(taskId: string): Res<void> {
    return this.inner.deleteTask(taskId);
  }

  getCredit(now?: number): Res<CreditBalance> {
    return this.inner.getCredit(now);
  }

  getFeatureCosts(): Res<Sku[]> {
    return this.inner.getFeatureCosts();
  }
}

/** One captured task as a fixture, with signed URLs scrubbed. Input images are never part of it. */
export function toFixture(
  cap: Capture,
  meta: { name: string; unitsCharged: number; recordedAt: string },
): { fixture: Fixture; urls: Record<string, string> } {
  if (cap.outcome === undefined || cap.latencyMs === undefined)
    throw new Error("The task never finished");
  const urls: Record<string, string> = {};
  const outcome =
    cap.outcome.status === "success"
      ? (() => {
          const scrubbed = scrubUrls(cap.outcome.results);
          Object.assign(urls, scrubbed.replaced);
          return { status: "success" as const, results: scrubbed.value };
        })()
      : {
          status: "error" as const,
          error: cap.outcome.error,
          ...(cap.outcome.message === undefined ? {} : { message: cap.outcome.message }),
        };
  return {
    fixture: {
      feature: cap.feature.slug,
      version: cap.feature.version,
      name: meta.name,
      recordedAt: meta.recordedAt,
      key: bodyKey(cap.feature.slug, cap.body),
      latencyMs: cap.latencyMs,
      outcome,
      unitsCharged: cap.outcome.status === "success" ? meta.unitsCharged : 0,
    },
    urls,
  };
}

export interface RecordArgs {
  feature: FeatureSlug;
  input: string;
  params: unknown;
  name: string;
  /** A second image for features that take a garment or reference. */
  ref?: string;
}

export function parseRecordArgs(
  argv: readonly string[],
): { ok: true; value: RecordArgs } | { ok: false; error: string } {
  const [feature, ...rest] = argv;
  if (!feature || !(feature in FEATURES)) {
    return { ok: false, error: `Name a feature: ${Object.keys(FEATURES).join(", ")}` };
  }
  const flag = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    return i === -1 ? undefined : rest[i + 1];
  };
  const input = flag("input");
  if (!input) return { ok: false, error: "--input <image file> is required" };
  let params: unknown = {};
  const raw = flag("params");
  if (raw !== undefined) {
    try {
      params = JSON.parse(raw);
    } catch {
      return { ok: false, error: "--params must be JSON" };
    }
  }
  const slug = feature as FeatureSlug;
  const ref = flag("ref");
  return {
    ok: true,
    value: {
      feature: slug,
      input,
      params,
      name: flag("name") ?? "recording-1",
      ...(ref === undefined ? {} : { ref }),
    },
  };
}

/** A single-node graph: the recorder runs the feature exactly as a workflow would. */
export function recordGraph(args: RecordArgs, inputKey: string, refKey?: string): GraphSpec {
  const f = FEATURES[args.feature];
  return {
    type: "demo",
    nodes: [
      {
        id: "record",
        kind: "youcam",
        label: "step.record",
        feature: args.feature,
        params: args.params as Record<string, unknown>,
        inputs:
          f.inputs === "single+ref" && refKey
            ? { src: `blob:${inputKey}`, ref: `blob:${refKey}` }
            : { src: `blob:${inputKey}` },
      },
    ],
  };
}
