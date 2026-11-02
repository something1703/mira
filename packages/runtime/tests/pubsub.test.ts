import { PubSub } from "@google-cloud/pubsub";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PubSubEventBus } from "../src/gcp/pubsub";

/**
 * Runs only against the Pub/Sub emulator (`pnpm --filter @mira/runtime test:emulator` starts it
 * and sets PUBSUB_EMULATOR_HOST). Without it these tests are skipped, not passed.
 */
const emulator = process.env.PUBSUB_EMULATOR_HOST;
const client = emulator ? new PubSub({ projectId: "mira-test" }) : undefined;
const buses: PubSubEventBus[] = [];
afterAll(async () => {
  await Promise.all(
    buses.map(async (b) => {
      await b.close();
    }),
  );
  await client?.close();
});

const until = async (ok: () => boolean, ms = 8_000) => {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
};

describe.skipIf(!emulator)("PubSubEventBus (emulator)", { timeout: 30_000 }, () => {
  const make = async (topic: string) => {
    await (client as PubSub).createTopic(topic);
    const bus = new PubSubEventBus({
      client: client as PubSub,
      instanceId: randomUUID().slice(0, 8),
    });
    buses.push(bus);
    return bus;
  };

  it("delivers an event and its attributes to a listener", async () => {
    const topic = `run-events-${randomUUID().slice(0, 8)}`;
    const bus = await make(topic);
    const got: { event: unknown; attributes: Record<string, string> }[] = [];
    bus.subscribe(topic, (event, attributes) => {
      got.push({ event, attributes: { ...attributes } });
    });
    // The subscription is made when the first listener arrives; publish once it exists.
    await new Promise((r) => setTimeout(r, 1_500));
    await bus.publish(topic, { type: "node_done", runId: "run_1" }, { miraTrace: "trc_1" });
    await until(() => got.length > 0);
    expect(got).toEqual([
      { event: { type: "node_done", runId: "run_1" }, attributes: { miraTrace: "trc_1" } },
    ]);
  });

  it("reaches every instance, and a failing listener does not stop the others", async () => {
    const topic = `run-events-${randomUUID().slice(0, 8)}`;
    const a = await make(topic);
    const b = new PubSubEventBus({ client: client as PubSub, instanceId: "other" });
    buses.push(b);
    const seenA: unknown[] = [];
    const seenB: unknown[] = [];
    a.subscribe(topic, () => {
      throw new Error("a listener that breaks");
    });
    a.subscribe(topic, (e) => {
      seenA.push(e);
    });
    b.subscribe(topic, (e) => {
      seenB.push(e);
    });
    await new Promise((r) => setTimeout(r, 2_000));
    await a.publish(topic, { n: 1 });
    await until(() => seenA.length > 0 && seenB.length > 0);
    expect(seenA).toEqual([{ n: 1 }]);
    expect(seenB).toEqual([{ n: 1 }]);
  });

  it("stops delivering to a listener that unsubscribed", async () => {
    const topic = `run-events-${randomUUID().slice(0, 8)}`;
    const bus = await make(topic);
    const seen: unknown[] = [];
    const off = bus.subscribe(topic, (e) => {
      seen.push(e);
    });
    await new Promise((r) => setTimeout(r, 1_500));
    off();
    await bus.publish(topic, { n: 2 });
    await new Promise((r) => setTimeout(r, 1_000));
    expect(seen).toEqual([]);
  });
});
