import { describe, expect, it } from "vitest";
import { CloudTasksQueue, deliveryAttempt, type CloudTasksClientLike } from "../src/gcp/tasks";
import { taskCallVerifier } from "../src/gcp/verify";

function fakeClient(existing = new Set<string>()) {
  const created: Parameters<CloudTasksClientLike["createTask"]>[0][] = [];
  const client: CloudTasksClientLike = {
    queuePath: (p, l, q) => `projects/${p}/locations/${l}/queues/${q}`,
    createTask: (req) => {
      const name = req.task.name;
      if (name && existing.has(name)) {
        return Promise.reject(Object.assign(new Error("exists"), { code: 6 }));
      }
      if (name) existing.add(name);
      created.push(req);
      return Promise.resolve({});
    },
  };
  return { client, created };
}

const opts = (client: CloudTasksClientLike) => ({
  client,
  project: "p",
  location: "asia-south1",
  targetUrl: "https://workflows.example.run.app",
  serviceAccountEmail: "tasks@p.iam.gserviceaccount.com",
  now: () => 1_000_000,
});

describe("CloudTasksQueue", () => {
  it("posts the payload to the queue's route with an ID token for the service account", async () => {
    const { client, created } = fakeClient();
    const q = new CloudTasksQueue(opts(client));
    expect(await q.enqueue("youcam-poll", { payload: { kind: "poll", n: 1 } })).toEqual({
      accepted: true,
    });
    const req = created[0]!;
    expect(req.parent).toBe("projects/p/locations/asia-south1/queues/youcam-poll");
    expect(req.task.httpRequest.url).toBe(
      "https://workflows.example.run.app/internal/tasks/youcam-poll",
    );
    expect(JSON.parse(req.task.httpRequest.body.toString())).toEqual({ kind: "poll", n: 1 });
    expect(req.task.httpRequest.oidcToken).toEqual({
      serviceAccountEmail: "tasks@p.iam.gserviceaccount.com",
      audience: "https://workflows.example.run.app",
    });
    expect(req.task.name).toBeUndefined();
    expect(req.task.scheduleTime).toBeUndefined();
  });

  it("schedules a delayed task and rounds up to a whole second", async () => {
    const { client, created } = fakeClient();
    await new CloudTasksQueue(opts(client)).enqueue("youcam-poll", { payload: {}, delayMs: 2_500 });
    expect(created[0]?.task.scheduleTime).toEqual({ seconds: 1003 });
  });

  it("drops a second task with the same dedupe key, per queue", async () => {
    const { client, created } = fakeClient();
    const q = new CloudTasksQueue(opts(client));
    expect((await q.enqueue("youcam-poll", { payload: {}, dedupeKey: "k" })).accepted).toBe(true);
    expect((await q.enqueue("youcam-poll", { payload: {}, dedupeKey: "k" })).accepted).toBe(false);
    expect((await q.enqueue("engine-jobs", { payload: {}, dedupeKey: "k" })).accepted).toBe(true);
    expect(created).toHaveLength(2);
    expect(created[0]?.task.name).toMatch(/\/tasks\/[0-9a-f]{64}$/);
  });

  it("passes on any other failure", async () => {
    const client: CloudTasksClientLike = {
      queuePath: () => "q",
      createTask: () => Promise.reject(Object.assign(new Error("denied"), { code: 7 })),
    };
    await expect(
      new CloudTasksQueue(opts(client)).enqueue("engine-jobs", { payload: {} }),
    ).rejects.toThrow("denied");
  });
});

describe("deliveryAttempt", () => {
  it("is the retry count plus one, and 1 when the header is missing or odd", () => {
    expect(deliveryAttempt({ "x-cloudtasks-taskretrycount": "0" })).toBe(1);
    expect(deliveryAttempt({ "x-cloudtasks-taskretrycount": "3" })).toBe(4);
    expect(deliveryAttempt({})).toBe(1);
    expect(deliveryAttempt({ "x-cloudtasks-taskretrycount": "x" })).toBe(1);
    expect(deliveryAttempt({ "x-cloudtasks-taskretrycount": "-2" })).toBe(1);
  });
});

describe("taskCallVerifier", () => {
  const ok = { email: "tasks@p.iam.gserviceaccount.com", email_verified: true };
  const make = (claims: unknown) =>
    taskCallVerifier({
      audience: "https://workflows.example.run.app",
      serviceAccountEmail: "tasks@p.iam.gserviceaccount.com",
      verifyIdToken: (_t, aud) => {
        if (aud !== "https://workflows.example.run.app") return Promise.reject(new Error("aud"));
        return claims instanceof Error ? Promise.reject(claims) : Promise.resolve(claims as never);
      },
    });

  it("accepts only a verified token from the expected service account", async () => {
    expect(await make(ok)("Bearer abc")).toBe(true);
    expect(await make({ ...ok, email: "other@p.iam.gserviceaccount.com" })("Bearer abc")).toBe(
      false,
    );
    expect(await make({ ...ok, email_verified: false })("Bearer abc")).toBe(false);
    expect(await make(undefined)("Bearer abc")).toBe(false);
  });

  it("refuses a missing or malformed header and a token that does not verify", async () => {
    expect(await make(ok)(undefined)).toBe(false);
    expect(await make(ok)("abc")).toBe(false);
    expect(await make(ok)("Basic abc")).toBe(false);
    expect(await make(new Error("bad signature"))("Bearer abc")).toBe(false);
  });
});
