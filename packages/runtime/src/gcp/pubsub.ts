import type { PubSub, Subscription } from "@google-cloud/pubsub";
import type { EventBus, Listener } from "../ports/events";

/**
 * The live event bus: one Pub/Sub topic per bus topic (`run-events`). Every service instance
 * that listens gets its own short-lived subscription, so an event reaches every instance and the
 * one holding a person's open stream can pass it on. The subscription is named for the instance,
 * is created when the first listener on a topic arrives, and expires on its own after a day
 * without a pull, so instances that stop leave nothing behind.
 *
 * Delivery is at least once and not ordered. Listeners already ignore events they do not need;
 * `node_done` and the like carry their own state, so a repeat is harmless.
 */
export interface PubSubBusOptions {
  client: PubSub;
  /** Names this instance's subscriptions, e.g. the Cloud Run revision plus a random suffix. */
  instanceId: string;
  /** Called when a subscription cannot be made or breaks; the bus keeps working for publishing. */
  onError?: (error: unknown) => void;
}

const ALREADY_EXISTS = 6;

export class PubSubEventBus implements EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly streams = new Map<string, Promise<Subscription | undefined>>();

  constructor(private readonly o: PubSubBusOptions) {}

  async publish(
    topic: string,
    event: unknown,
    attributes: Record<string, string> = {},
  ): Promise<void> {
    await this.o.client.topic(topic).publishMessage({ json: event, attributes });
  }

  subscribe(topic: string, listener: Listener): () => void {
    const set = this.listeners.get(topic) ?? new Set();
    set.add(listener);
    this.listeners.set(topic, set);
    if (!this.streams.has(topic)) this.streams.set(topic, this.open(topic));
    return () => {
      set.delete(listener);
    };
  }

  /** Stops every subscription this instance opened (on shutdown). */
  async close(): Promise<void> {
    const streams = await Promise.all(this.streams.values());
    this.streams.clear();
    await Promise.all(streams.map(async (s) => await s?.close()));
  }

  private async open(topic: string): Promise<Subscription | undefined> {
    const name = `${topic}-${this.o.instanceId}`;
    const t = this.o.client.topic(topic);
    try {
      let subscription: Subscription;
      try {
        [subscription] = await t.createSubscription(name, {
          expirationPolicy: { ttl: { seconds: 24 * 60 * 60 } },
          messageRetentionDuration: { seconds: 10 * 60 },
          ackDeadlineSeconds: 10,
        });
      } catch (error) {
        if ((error as { code?: unknown }).code !== ALREADY_EXISTS) throw error;
        subscription = t.subscription(name);
      }
      subscription.on("message", (message) => {
        message.ack();
        let event: unknown;
        try {
          event = JSON.parse(message.data.toString("utf8")) as unknown;
        } catch {
          return; // not ours
        }
        const attributes = { ...message.attributes };
        for (const listener of [...(this.listeners.get(topic) ?? [])]) {
          // One failing subscriber must not stop the others (as the in-process bus).
          void Promise.resolve()
            .then(async () => {
              await listener(event, attributes);
            })
            .catch(() => undefined);
        }
      });
      subscription.on("error", (error) => {
        this.o.onError?.(error);
      });
      return subscription;
    } catch (error) {
      this.o.onError?.(error);
      this.streams.delete(topic); // the next listener tries again
      return undefined;
    }
  }
}
