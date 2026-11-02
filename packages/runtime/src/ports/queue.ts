import type { Clock } from "./clock";

/** Queue names match Terraform (docs/ARCHITECTURE.md): `youcam-submit`, `youcam-poll`, `engine-jobs`. */
export type QueueName = "youcam-submit" | "youcam-poll" | "engine-jobs";

export interface QueueTask {
  payload: unknown;
  /** Delivery no earlier than this many milliseconds from now (a delayed poll). */
  delayMs?: number;
  /**
   * Cloud Tasks de-duplicates by task name. A second enqueue with the same key is dropped, so a
   * crash-and-retry never queues the same poll twice.
   */
  dedupeKey?: string;
}

export interface TaskQueue {
  enqueue(queue: QueueName, task: QueueTask): Promise<{ accepted: boolean }>;
}

export interface Delivery {
  queue: QueueName;
  payload: unknown;
  /** 1 for the first delivery. */
  attempt: number;
  dedupeKey?: string;
}

export type DeliveryHandler = (delivery: Delivery) => Promise<void>;

interface Pending extends Delivery {
  runAt: number;
}

export interface InProcessQueueOptions {
  clock: Clock;
  /** Deliveries beyond this are dropped and reported through `onDead`. Cloud Tasks retries too. */
  maxAttempts?: number;
  /** Retry delay for attempt n is `backoffMs * 2^(n-1)`. */
  backoffMs?: number;
  onDead?: (delivery: Delivery, error: unknown) => void;
}

/**
 * In-process queue for mock mode and tests. `tick()` delivers everything that is due, so tests
 * drive it with a fake clock; `start()` ticks on an interval for `pnpm dev:mock`. Live this is
 * Cloud Tasks, whose queue rate limits keep YouCam polls under 250 requests per 5 minutes.
 */
export class InProcessQueue implements TaskQueue {
  private pending: Pending[] = [];
  private seen = new Set<string>();
  private handler: DeliveryHandler | undefined;
  private deadHandler: ((delivery: Delivery, error: unknown) => void | Promise<void>) | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;

  constructor(private readonly options: InProcessQueueOptions) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.backoffMs = options.backoffMs ?? 1_000;
  }

  setHandler(handler: DeliveryHandler): void {
    this.handler = handler;
  }

  /** Called when a delivery has failed every attempt (Cloud Tasks: the dead-letter step). */
  setDeadHandler(handler: (delivery: Delivery, error: unknown) => void | Promise<void>): void {
    this.deadHandler = handler;
  }

  enqueue(queue: QueueName, task: QueueTask): Promise<{ accepted: boolean }> {
    if (task.dedupeKey !== undefined) {
      const key = `${queue}:${task.dedupeKey}`;
      if (this.seen.has(key)) return Promise.resolve({ accepted: false });
      this.seen.add(key);
    }
    this.pending.push({
      queue,
      payload: JSON.parse(JSON.stringify(task.payload)) as unknown,
      attempt: 1,
      ...(task.dedupeKey === undefined ? {} : { dedupeKey: task.dedupeKey }),
      runAt: this.options.clock.now() + (task.delayMs ?? 0),
    });
    return Promise.resolve({ accepted: true });
  }

  /** Everything not yet delivered, soonest first. */
  snapshot(): readonly Readonly<Pending>[] {
    return [...this.pending].sort((a, b) => a.runAt - b.runAt);
  }

  /** Delivers every task that is due now, one at a time, in order. Returns how many ran. */
  async tick(): Promise<number> {
    const handler = this.handler;
    if (handler === undefined) throw new Error("InProcessQueue has no handler");
    let delivered = 0;
    for (;;) {
      const now = this.options.clock.now();
      const due = this.snapshot().find((p) => p.runAt <= now);
      if (due === undefined) return delivered;
      this.pending = this.pending.filter((p) => p !== due);
      delivered += 1;
      const { runAt: _runAt, ...delivery } = due;
      try {
        await handler(delivery);
      } catch (error) {
        if (due.attempt >= this.maxAttempts) {
          this.options.onDead?.(delivery, error);
          await this.deadHandler?.(delivery, error);
        } else {
          this.pending.push({
            ...due,
            attempt: due.attempt + 1,
            runAt: this.options.clock.now() + this.backoffMs * 2 ** (due.attempt - 1),
          });
        }
      }
    }
  }

  start(intervalMs = 250): void {
    // A tick that is still delivering must not be started again by the timer: two ticks at once
    // would run two deliveries of the same node, which mock mode must not do and live cannot rule out.
    let busy = false;
    this.timer ??= setInterval(() => {
      if (busy) return;
      busy = true;
      void this.tick()
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
