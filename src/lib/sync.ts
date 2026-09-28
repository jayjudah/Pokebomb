// Pushes queued changes to the server, then pulls the server's copy.
// Backend-agnostic so it can be tested without a network.
import { toBatches, type Batch, type Op, type Row } from "./ops";

export interface Backend {
  apply(batch: Batch): Promise<void>;
  pull(): Promise<Row[]>;
}

export interface SyncStore {
  pending(): Op[];
  /** The server confirmed these; drop them from the queue. */
  confirmed(ops: Op[]): void;
  /** Fresh server snapshot. The store replays whatever is still queued on top. */
  snapshot(rows: Row[]): void;
}

export type SyncState = "idle" | "syncing" | "offline" | "error";

export class SyncEngine {
  private running: Promise<void> | null = null;
  private again = false;
  state: SyncState = "idle";
  lastError = "";
  lastSynced = 0;
  onState?: (s: SyncState) => void;

  constructor(
    private backend: Backend,
    private store: SyncStore,
  ) {}

  /** Push then pull. Calls made while a sync runs are folded into one more pass. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.once();
      } while (this.again && this.state !== "offline" && this.state !== "error");
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private set(s: SyncState) {
    this.state = s;
    this.onState?.(s);
  }

  private async once() {
    this.set("syncing");
    try {
      // Confirm batch by batch: a failure midway keeps only the unsent ops
      // queued, and the server ignores op ids it has already applied.
      for (const batch of toBatches(this.store.pending())) {
        await this.backend.apply(batch);
        this.store.confirmed(batch.ops);
      }
      this.store.snapshot(await this.backend.pull());
      this.lastSynced = Date.now();
      this.lastError = "";
      this.set("idle");
    } catch (err) {
      this.lastError = (err as Error).message;
      this.set(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error");
    }
  }
}
