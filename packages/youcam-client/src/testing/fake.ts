import { err, ok, type Result } from "@mira/schemas";
import type { Clock } from "@mira/runtime";
import { type CreditBalance, type RegisteredFile, type TaskState, type YouCamApi } from "../api";
import { mapTaskError, type YouCamError } from "../errors";
import { slugOf, type Sku } from "../pricing";

/**
 * A synthetic YouCam for lifecycle tests and the demo graph. It follows the documented behaviour
 * (register, PUT, create, poll, delete, units charged only on success) and nothing more. It is not
 * a recording: results are made up, so runs against it are never labelled "recorded".
 */

type Res<T> = Promise<Result<T, YouCamError>>;
type TaskRef = { slug: string; version: string };

export interface FakeTaskScript {
  /** Milliseconds on the injected clock before the task leaves `running`. Default 5 000. */
  latencyMs?: number;
  /** Makes the task end in this upstream error code instead of succeeding. */
  failWith?: string;
  /** The `results` object for a success. Default `{ url: "https://fake.invalid/<taskId>.png" }`. */
  results?: unknown;
}

export interface FakeOptions {
  clock: Clock;
  /** Unit price per feature slug, charged on success. Default 1 for anything unlisted. */
  prices?: Record<string, number>;
  startingUnits?: number;
}

interface Task {
  feature: string;
  createdAt: number;
  script: FakeTaskScript;
  charged: boolean;
}

export class FakeYouCam implements YouCamApi {
  readonly calls: { op: string; detail?: string }[] = [];
  readonly files = new Map<string, { uploaded: boolean; bytes?: number }>();
  readonly tasks = new Map<string, Task>();
  readonly deleted = new Set<string>();
  units: number;
  private nextId = 1;
  private readonly scripts: Record<string, FakeTaskScript[]> = {};
  private rateLimited = 0;
  private networkFailures = 0;

  constructor(private readonly options: FakeOptions) {
    this.units = options.startingUnits ?? 1_000;
  }

  /** Queue the script for the next task created for a feature. */
  script(slug: string, script: FakeTaskScript): this {
    (this.scripts[slug] ??= []).push(script);
    return this;
  }

  /** The next `n` API calls answer 429. */
  rateLimitNext(n: number): void {
    this.rateLimited = n;
  }

  /** The next `n` API calls fail at the network. */
  failNetworkNext(n: number): void {
    this.networkFailures = n;
  }

  callsTo(op: string): number {
    return this.calls.filter((c) => c.op === op).length;
  }

  private gate(op: string, detail?: string): YouCamError | undefined {
    this.calls.push(detail === undefined ? { op } : { op, detail });
    if (this.networkFailures > 0) {
      this.networkFailures -= 1;
      return {
        kind: "network",
        code: "network",
        message: "fake network failure",
        retryable: true,
        guidance: "retry",
        unitsCharged: 0,
      };
    }
    if (this.rateLimited > 0) {
      this.rateLimited -= 1;
      return {
        kind: "rate_limited",
        code: "rate_limited",
        message: "Too many requests",
        status: 429,
        retryable: true,
        guidance: "retry",
        unitsCharged: 0,
      };
    }
    return undefined;
  }

  registerFile(input: {
    contentType: string;
    fileName: string;
    fileSize: number;
  }): Res<RegisteredFile> {
    const blocked = this.gate("registerFile");
    if (blocked) return Promise.resolve(err(blocked));
    const fileId = `fake_file_${String(this.nextId++)}`;
    this.files.set(fileId, { uploaded: false });
    return Promise.resolve(
      ok({
        fileId,
        method: "PUT",
        url: `https://fake.invalid/upload/${fileId}`,
        headers: { "Content-Type": input.contentType, "Content-Length": String(input.fileSize) },
      }),
    );
  }

  putBytes(file: RegisteredFile, bytes: Uint8Array): Res<void> {
    const blocked = this.gate("putBytes", file.fileId);
    if (blocked) return Promise.resolve(err(blocked));
    const f = this.files.get(file.fileId);
    if (f) {
      f.uploaded = true;
      f.bytes = bytes.byteLength;
    }
    return Promise.resolve(ok(undefined));
  }

  createTask(feature: TaskRef, body: Record<string, unknown>): Res<{ taskId: string }> {
    const blocked = this.gate("createTask", feature.slug);
    if (blocked) return Promise.resolve(err(blocked));
    const ids = ["src_file_id", "ref_file_id"]
      .map((k) => body[k])
      .filter((v): v is string => typeof v === "string");
    for (const id of ids) {
      // Skipping the PUT makes real tasks fail later; the fake fails them the same way.
      if (this.files.get(id)?.uploaded !== true) {
        return Promise.resolve(
          err(mapTaskError("unknown_internal_error", `file ${id} was never uploaded`)),
        );
      }
    }
    const taskId = `fake_task_${String(this.nextId++)}`;
    this.tasks.set(taskId, {
      feature: feature.slug,
      createdAt: this.options.clock.now(),
      script: this.scripts[feature.slug]?.shift() ?? {},
      charged: false,
    });
    return Promise.resolve(ok({ taskId }));
  }

  getTask(feature: TaskRef, taskId: string): Res<TaskState> {
    const blocked = this.gate("getTask", taskId);
    if (blocked) return Promise.resolve(err(blocked));
    const task = this.tasks.get(taskId);
    if (!task || this.deleted.has(taskId)) {
      return Promise.resolve(
        err({
          kind: "http",
          code: "InvalidTaskId",
          message: "InvalidTaskId",
          status: 400,
          upstream: "InvalidTaskId",
          retryable: false,
          guidance: "none",
          unitsCharged: 0,
        }),
      );
    }
    if (this.options.clock.now() - task.createdAt < (task.script.latencyMs ?? 5_000)) {
      return Promise.resolve(ok({ status: "running" }));
    }
    if (task.script.failWith !== undefined) {
      return Promise.resolve(ok({ status: "error", error: mapTaskError(task.script.failWith) }));
    }
    if (!task.charged) {
      task.charged = true;
      this.units -= this.options.prices?.[feature.slug] ?? 1;
    }
    return Promise.resolve(
      ok({
        status: "success",
        results: task.script.results ?? { url: `https://fake.invalid/${taskId}.png` },
      }),
    );
  }

  deleteTask(taskId: string): Res<void> {
    const blocked = this.gate("deleteTask", taskId);
    if (blocked) return Promise.resolve(err(blocked));
    const task = this.tasks.get(taskId);
    if (!task) {
      return Promise.resolve(
        err({
          kind: "http",
          code: "InvalidTaskId",
          message: "InvalidTaskId",
          status: 400,
          upstream: "InvalidTaskId",
          retryable: false,
          guidance: "none",
          unitsCharged: 0,
        }),
      );
    }
    if (this.options.clock.now() - task.createdAt < (task.script.latencyMs ?? 5_000)) {
      return Promise.resolve(
        err({
          kind: "http",
          code: "OperationInvalid",
          message: "task not finished yet",
          status: 400,
          upstream: "OperationInvalid",
          retryable: false,
          guidance: "none",
          unitsCharged: 0,
        }),
      );
    }
    this.deleted.add(taskId);
    return Promise.resolve(ok(undefined));
  }

  getCredit(): Res<CreditBalance> {
    const blocked = this.gate("getCredit");
    if (blocked) return Promise.resolve(err(blocked));
    return Promise.resolve(ok({ units: this.units, entries: [{ units: this.units }] }));
  }

  getFeatureCosts(): Res<Sku[]> {
    const blocked = this.gate("getFeatureCosts");
    if (blocked) return Promise.resolve(err(blocked));
    const prices = this.options.prices ?? {};
    return Promise.resolve(
      ok(
        Object.entries(prices).map(([slug, amount]) => ({
          amount,
          unit: "result_image" as const,
          slug: slugOf(`https://fake.invalid/s2s/v2.0/task/${slug}`),
        })),
      ),
    );
  }
}
