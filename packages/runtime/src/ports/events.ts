/** Progress events (`run-events`). Live this is Pub/Sub; the web app reads them over SSE. */
export interface EventBus {
  publish(topic: string, event: unknown, attributes?: Record<string, string>): Promise<void>;
  subscribe(topic: string, listener: Listener): () => void;
}

/** Attributes are Pub/Sub message attributes, e.g. `miraTrace` (TRACE_ATTRIBUTE). */
export type Listener = (
  event: unknown,
  attributes: Readonly<Record<string, string>>,
) => void | Promise<void>;

export class InProcessEventBus implements EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  async publish(
    topic: string,
    event: unknown,
    attributes: Record<string, string> = {},
  ): Promise<void> {
    const copy = JSON.parse(JSON.stringify(event)) as unknown;
    const attrs = { ...attributes };
    for (const listener of [...(this.listeners.get(topic) ?? [])]) {
      try {
        await listener(copy, attrs);
      } catch {
        // One failing subscriber must not stop the others or fail the run that published.
      }
    }
  }

  subscribe(topic: string, listener: Listener): () => void {
    const set = this.listeners.get(topic) ?? new Set();
    set.add(listener);
    this.listeners.set(topic, set);
    return () => {
      set.delete(listener);
    };
  }
}
