// The collection store. Every change is an operation (see ops.ts): signed
// out it applies to the on-device copy; signed in it's also queued and
// synced to the account (see cloud.ts). Saved in IndexedDB either way.
import { get, set } from "idb-keyval";
import { useSyncExternalStore } from "react";
import { getCard } from "./cardDb";
import { CollectionState } from "./collectionState";
import { newOpId, type Op, type Row } from "./ops";
import type { SyncStore } from "./sync";
import type { CardInfo, OwnedCard } from "./types";

const KEY = "collection-v2";
const LEGACY_KEY = "collection-v1";

let state = new CollectionState();
let cards: OwnedCard[] = [];
const listeners = new Set<() => void>();
let changeHook: (() => void) | null = null;

function refresh() {
  cards = state.view();
  listeners.forEach((l) => l());
  void set(KEY, state.save());
}

function commit(op: Op) {
  state.apply(op);
  refresh();
  changeHook?.();
}

export const ready: Promise<void> = (async () => {
  const saved = (await get(KEY)) ?? (await get(LEGACY_KEY));
  state = CollectionState.from(saved);
  cards = state.view();
  listeners.forEach((l) => l());
})();

/** Called on every local change (cloud.ts uses it to schedule a sync). */
export function setChangeHook(fn: () => void) {
  changeHook = fn;
}

export const collectionSyncStore: SyncStore = {
  pending: () => state.pending(),
  confirmed: (ops) => {
    state.confirmed(ops);
    refresh();
  },
  snapshot: (rows: Row[]) => {
    state.snapshot(rows);
    refresh();
  },
};

export async function onSignedIn(userId: string): Promise<number> {
  await ready;
  const merged = state.signIn(userId);
  refresh();
  return merged;
}

export async function onSignedOut() {
  await ready;
  state.signOut();
  refresh();
}

export function unsyncedChanges(): number {
  return state.pending().length;
}

export function useCollection(): OwnedCard[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => cards,
  );
}

export function getCollection(): OwnedCard[] {
  return cards;
}

export function addCard(card: CardInfo, qty = 1): OwnedCard {
  commit({ kind: "add", op: newOpId(), id: card.id, delta: qty, info: card });
  return cards.find((c) => c.id === card.id)!;
}

/** Add or remove copies of a card already in the collection. */
export function adjustQty(id: string, delta: number) {
  const info = cards.find((c) => c.id === id);
  commit({ kind: "add", op: newOpId(), id, delta, info });
}

/**
 * Fill in price, legality and rarity from TCGdex after an offline scan.
 * Best effort: without a connection the card just keeps what the index knew.
 */
export async function enrichCard(id: string) {
  try {
    const full = await getCard(id);
    if (!cards.some((c) => c.id === id)) return;
    commit({ kind: "add", op: newOpId(), id, delta: 0, info: full });
  } catch {
    /* offline */
  }
}

/** Make the collection exactly `next` (restore a backup, or clear with []). */
export function replaceCollection(next: OwnedCard[]) {
  const keep = new Set(next.map((c) => c.id));
  for (const c of cards) if (!keep.has(c.id)) state.apply({ kind: "set", op: newOpId(), id: c.id, qty: 0 });
  for (const c of next) state.apply({ kind: "set", op: newOpId(), id: c.id, qty: c.qty, info: c });
  refresh();
  changeHook?.();
}

export function exportJson(): string {
  return JSON.stringify({ app: "pokebomb", version: 1, exportedAt: new Date().toISOString(), cards }, null, 1);
}

export function exportCsv(): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["Quantity", "Name", "Set", "Number", "Category", "Regulation", "TCGdex ID"]];
  for (const c of cards) rows.push([String(c.qty), c.name, c.setName, c.localId, c.category, c.regulationMark ?? "", c.id]);
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

export function parseImport(text: string): OwnedCard[] {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data.cards;
  if (!Array.isArray(list)) throw new Error("No cards found in that file.");
  return list.filter((c) => c && typeof c.id === "string" && typeof c.name === "string" && c.qty > 0);
}
