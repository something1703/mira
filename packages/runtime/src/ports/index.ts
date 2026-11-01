import { join } from "node:path";
import { FileBlobStore, MemoryBlobStore, type BlobStore } from "./blobs";
import { systemClock, type Clock } from "./clock";
import { InProcessEventBus, type EventBus } from "./events";
import { InProcessQueue } from "./queue";
import { FileStateStore, MemoryStateStore, type StateStore } from "./state";

export * from "./blobs";
export * from "./clock";
export * from "./events";
export * from "./queue";
export * from "./state";
export * from "./typed";

export interface Ports {
  readonly clock: Clock;
  readonly state: StateStore;
  readonly queue: InProcessQueue;
  readonly events: EventBus;
  readonly blobs: BlobStore;
}

export interface MockPortsOptions {
  clock?: Clock;
  /** Directory for file-backed state and blobs. Omit for pure in-memory (tests). */
  dir?: string;
}

/**
 * The mock-mode adapters (D10): file-backed state and blobs, in-process queue and bus. Live mode
 * uses Firestore, Cloud Tasks, Pub/Sub and Cloud Storage behind the same interfaces; those
 * adapters are built at deploy time (phases/PHASE_01).
 */
export function createMockPorts(options: MockPortsOptions = {}): Ports {
  const clock = options.clock ?? systemClock;
  const { dir } = options;
  return {
    clock,
    state: dir ? new FileStateStore(join(dir, "state")) : new MemoryStateStore(),
    queue: new InProcessQueue({ clock }),
    events: new InProcessEventBus(),
    blobs: dir ? new FileBlobStore(join(dir, "blobs")) : new MemoryBlobStore(),
  };
}
