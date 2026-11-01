import { err, ok, CONFIG, type Result } from "@mira/schemas";
import type { Clock } from "@mira/runtime";
import { type CreditBalance, type RegisteredFile, type TaskState, type YouCamApi } from "../api";
import { bodyKey, type Fixture } from "../fixtures";
import { mapTaskError, type YouCamError } from "../errors";
import type { Sku } from "../pricing";

type Res<T> = Promise<Result<T, YouCamError>>;

const noRecording = (slug: string): YouCamError => ({
  kind: "http",
  code: "no_recording",
  message: `No recording for this ${slug} request. Record one with pnpm fixtures:record.`,
  retryable: false,
  guidance: "none",
  unitsCharged: 0,
});

export interface ReplayOptions {
  clock: Clock;
  fixtures: readonly Fixture[];
  /** Prices captured with the recordings; quotes in a recorded run use these (Quote.pricing). */
  skus: readonly Sku[];
  /** Recorded latencies are scaled by this so progress UI is exercised without the wait. */
  latencyScale?: number;
  units?: number;
}

/**
 * Replays recorded responses, keyed by feature and request body (docs/TESTING.md). A request with
 * no recording fails with `no_recording` instead of inventing a result: mock mode only ever shows
 * things that really happened.
 */
export class ReplayYouCam implements YouCamApi {
  private readonly byKey = new Map<string, Fixture>();
  private readonly tasks = new Map<
    string,
    { fixture: Fixture; createdAt: number; charged?: boolean }
  >();
  private n = 1;
  units: number;

  constructor(private readonly o: ReplayOptions) {
    for (const f of o.fixtures) this.byKey.set(`${f.feature}:${f.key}`, f);
    this.units = o.units ?? 10_000;
  }

  registerFile(input: { contentType: string }): Res<RegisteredFile> {
    const fileId = `replay_file_${String(this.n++)}`;
    return Promise.resolve(
      ok({
        fileId,
        method: "PUT",
        url: `replay://upload/${fileId}`,
        headers: { "Content-Type": input.contentType },
      }),
    );
  }

  putBytes(): Res<void> {
    return Promise.resolve(ok(undefined));
  }

  createTask(feature: { slug: string }, body: Record<string, unknown>): Res<{ taskId: string }> {
    const fixture = this.byKey.get(`${feature.slug}:${bodyKey(feature.slug, body)}`);
    if (!fixture) return Promise.resolve(err(noRecording(feature.slug)));
    const taskId = `replay_task_${String(this.n++)}`;
    this.tasks.set(taskId, { fixture, createdAt: this.o.clock.now() });
    return Promise.resolve(ok({ taskId }));
  }

  getTask(_feature: { slug: string }, taskId: string): Res<TaskState> {
    const t = this.tasks.get(taskId);
    if (!t)
      return Promise.resolve(
        err({ ...noRecording("task"), code: "InvalidTaskId", upstream: "InvalidTaskId" }),
      );
    const wait = t.fixture.latencyMs * (this.o.latencyScale ?? CONFIG.mock.latencyScale.value);
    if (this.o.clock.now() - t.createdAt < wait) return Promise.resolve(ok({ status: "running" }));
    const out = t.fixture.outcome;
    if (out.status === "error") {
      return Promise.resolve(ok({ status: "error", error: mapTaskError(out.error, out.message) }));
    }
    // Charged once, however many times the task is polled.
    if (!t.charged) {
      t.charged = true;
      this.units -= t.fixture.unitsCharged;
    }
    return Promise.resolve(ok({ status: "success", results: out.results }));
  }

  deleteTask(taskId: string): Res<void> {
    this.tasks.delete(taskId);
    return Promise.resolve(ok(undefined));
  }

  getCredit(): Res<CreditBalance> {
    return Promise.resolve(ok({ units: this.units, entries: [{ units: this.units }] }));
  }

  getFeatureCosts(): Res<Sku[]> {
    return Promise.resolve(ok([...this.o.skus]));
  }
}
