/** Progress events (`run-events`). Live this is Pub/Sub; the web app reads them over SSE. */
export interface EventBus {
  publish(topic: string, event: unknown, attributes?: Record<string, string>): Promise<void>;
  subscribe(topic: string, listener: (event: unknown) => void | Promise<void>): () => void;
}

export class InProcessEventBus implements EventBus {
  private readonly listeners = new Map<string, Set<(event: unknown) => void | Promise<void>>>();

  async publish(topic: string, event: unknown): Promise<void> {
    const copy = JSON.parse(JSON.stringify(event)) as unknown;
    for (const listener of [...(this.listeners.get(topic) ?? [])]) {
      try {
        await listener(copy);
      } catch {
        // One failing subscriber must not stop the others or fail the run that published.
      }
    }
  }

  subscribe(topic: string, listener: (event: unknown) => void | Promise<void>): () => void {
    const set = this.listeners.get(topic) ?? new Set();
    set.add(listener);
    this.listeners.set(topic, set);
    return () => {
      set.delete(listener);
    };
  }
}
