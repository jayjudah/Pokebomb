// Collection changes as operations. Signed out, they apply straight to the
// on-device collection. Signed in, they also queue up for the server and
// replay on top of the last server snapshot until the server confirms them,
// so the app stays instant and works offline.
import type { CardInfo, OwnedCard } from "./types";

export type Op =
  | { kind: "add"; op: string; id: string; delta: number; info?: CardInfo }
  | { kind: "set"; op: string; id: string; qty: number; info?: CardInfo };

/** A row of public.collection_cards. */
export interface Row {
  card_id: string;
  qty: number;
  data: Partial<CardInfo>;
  added_at: string;
}

export function newOpId(): string {
  return crypto.randomUUID();
}

// Card details without blanks, so a sparse offline read never wipes known values.
function known(info: CardInfo | undefined): Partial<CardInfo> {
  if (!info) return {};
  return Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined)) as Partial<CardInfo>;
}

export function applyOp(cards: OwnedCard[], op: Op, now = Date.now()): OwnedCard[] {
  const existing = cards.find((c) => c.id === op.id);
  const qty = op.kind === "add" ? Math.max(0, (existing?.qty ?? 0) + op.delta) : Math.max(0, op.qty);
  if (qty === 0) return existing ? cards.filter((c) => c.id !== op.id) : cards;
  if (existing) return cards.map((c) => (c.id === op.id ? { ...c, ...known(op.info), qty } : c));
  if (!op.info) return cards; // can't show a card we know nothing about; the server will fill it in
  return [{ ...op.info, qty, addedAt: now }, ...cards];
}

export function applyOps(cards: OwnedCard[], ops: Op[]): OwnedCard[] {
  return ops.reduce((acc, op) => applyOp(acc, op), cards);
}

export function rowsToCards(rows: Row[]): OwnedCard[] {
  return rows
    .filter((r) => r.qty > 0 && r.data?.name)
    .map((r) => ({ ...(r.data as CardInfo), id: r.card_id, qty: r.qty, addedAt: Date.parse(r.added_at) || 0 }))
    .sort((a, b) => b.addedAt - a.addedAt);
}

/** Card details worth storing server-side (everything except counts). */
export function cardData(info: CardInfo | undefined): Partial<CardInfo> {
  const d = known(info) as Partial<CardInfo> & { qty?: number; addedAt?: number };
  delete d.qty;
  delete d.addedAt;
  return d;
}

export interface Batch {
  kind: "add" | "set";
  ops: Op[];
}

/** Consecutive runs of the same kind, in order, so each run is one request. */
export function toBatches(ops: Op[], max = 500): Batch[] {
  const out: Batch[] = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    if (last && last.kind === op.kind && last.ops.length < max) last.ops.push(op);
    else out.push({ kind: op.kind, ops: [op] });
  }
  return out;
}

/** A signed-out collection, as changes to merge into an account. */
export function cardsToOps(cards: OwnedCard[]): Op[] {
  return cards.map((c) => ({ kind: "add", op: newOpId(), id: c.id, delta: c.qty, info: c }));
}
