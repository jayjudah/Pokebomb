// The collection as the app sees it: the last known server copy (or, signed
// out, the on-device collection) plus changes not yet confirmed.
import { applyOp, applyOps, cardsToOps, rowsToCards, type Op, type Row } from "./ops";
import type { SyncStore } from "./sync";
import type { OwnedCard } from "./types";

export interface SavedState {
  v: 2;
  account: string | null;
  base: OwnedCard[];
  pending: Op[];
}

export class CollectionState implements SyncStore {
  account: string | null = null;
  private base: OwnedCard[] = [];
  private queue: Op[] = [];
  private cached: OwnedCard[] | null = null;

  static from(saved: SavedState | OwnedCard[] | undefined): CollectionState {
    const s = new CollectionState();
    if (Array.isArray(saved)) s.base = saved; // v1: a plain list of cards
    else if (saved?.v === 2) {
      s.account = saved.account;
      s.base = saved.base;
      s.queue = saved.pending;
    }
    return s;
  }

  save(): SavedState {
    return { v: 2, account: this.account, base: this.base, pending: this.queue };
  }

  view(): OwnedCard[] {
    this.cached ??= applyOps(this.base, this.queue);
    return this.cached;
  }

  /** Record a change. Signed in, it's also queued for the server. */
  apply(op: Op) {
    if (this.account) this.queue.push(op);
    else this.base = applyOp(this.base, op);
    this.cached = null;
  }

  pending(): Op[] {
    return [...this.queue];
  }

  confirmed(ops: Op[]) {
    const done = new Set(ops.map((o) => o.op));
    // Fold into the base now so the screen doesn't flicker before the next pull.
    this.base = applyOps(this.base, ops);
    this.queue = this.queue.filter((o) => !done.has(o.op));
    this.cached = null;
  }

  snapshot(rows: Row[]) {
    this.base = rowsToCards(rows);
    this.cached = null;
  }

  /**
   * Switch to an account. Cards collected while signed out are merged into
   * it; a different account's cached cards are dropped. Returns how many
   * local cards were merged.
   */
  signIn(userId: string): number {
    if (this.account === userId) return 0;
    let merged = 0;
    if (this.account === null) {
      const local = this.view();
      merged = local.reduce((s, c) => s + c.qty, 0);
      this.queue = cardsToOps(local);
    } else {
      this.queue = [];
    }
    this.base = [];
    this.account = userId;
    this.cached = null;
    return merged;
  }

  /** Forget everything on this device (the account keeps its copy). */
  signOut() {
    this.account = null;
    this.base = [];
    this.queue = [];
    this.cached = null;
  }
}
