import { createHash } from "node:crypto";
import type { QueueName, QueueTask, TaskQueue } from "../ports/queue";

/**
 * The live task queue: Cloud Tasks queues named as in Terraform (`youcam-submit`, `youcam-poll`,
 * `engine-jobs`), delivering by HTTP to `mira-workflows` at `/internal/tasks/{queue}` with a
 * Google ID token for the service account (the receiving side checks it, `verifyTaskCall`).
 *
 * Duplicates: a task's name is a hash of the queue and `dedupeKey`, and Cloud Tasks refuses a
 * second task with a name it already holds. That also holds for about an hour after the task has
 * run, so a dedupe key must not be reused for fresh work inside that hour.
 */
export interface CloudTasksClientLike {
  queuePath(project: string, location: string, queue: string): string;
  createTask(request: {
    parent: string;
    task: {
      name?: string;
      scheduleTime?: { seconds: number };
      httpRequest: {
        httpMethod: "POST";
        url: string;
        headers: Record<string, string>;
        body: Buffer;
        oidcToken: { serviceAccountEmail: string; audience: string };
      };
    };
  }): Promise<unknown>;
}

export interface CloudTasksOptions {
  client: CloudTasksClientLike;
  project: string;
  location: string;
  /** Base URL of mira-workflows, no trailing slash. It is also the ID token's audience. */
  targetUrl: string;
  /** The service account the tasks run as; it needs `run.invoker` on mira-workflows. */
  serviceAccountEmail: string;
  now?: () => number;
}

const ALREADY_EXISTS = 6;

export class CloudTasksQueue implements TaskQueue {
  constructor(private readonly o: CloudTasksOptions) {}

  async enqueue(queue: QueueName, task: QueueTask): Promise<{ accepted: boolean }> {
    const parent = this.o.client.queuePath(this.o.project, this.o.location, queue);
    const now = (this.o.now ?? Date.now)();
    const body = Buffer.from(JSON.stringify(task.payload));
    try {
      await this.o.client.createTask({
        parent,
        task: {
          ...(task.dedupeKey === undefined
            ? {}
            : {
                name: `${parent}/tasks/${createHash("sha256")
                  .update(`${queue}:${task.dedupeKey}`)
                  .digest("hex")}`,
              }),
          ...(task.delayMs
            ? { scheduleTime: { seconds: Math.ceil((now + task.delayMs) / 1000) } }
            : {}),
          httpRequest: {
            httpMethod: "POST",
            url: `${this.o.targetUrl}/internal/tasks/${queue}`,
            headers: { "content-type": "application/json" },
            body,
            oidcToken: {
              serviceAccountEmail: this.o.serviceAccountEmail,
              audience: this.o.targetUrl,
            },
          },
        },
      });
      return { accepted: true };
    } catch (error) {
      if ((error as { code?: unknown }).code === ALREADY_EXISTS) return { accepted: false };
      throw error;
    }
  }
}

/** Cloud Tasks sends the retry number (0 for the first delivery) in this header. */
export function deliveryAttempt(headers: Record<string, string | string[] | undefined>): number {
  const raw = headers["x-cloudtasks-taskretrycount"];
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 0 ? n + 1 : 1;
}
