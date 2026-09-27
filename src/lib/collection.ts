// The collection lives in IndexedDB on the device. Export/import moves it
// between phones (or backs it up).
import { get, set } from "idb-keyval";
import { useSyncExternalStore } from "react";
import { getCard } from "./cardDb";
import type { CardInfo, OwnedCard } from "./types";

const KEY = "collection-v1";
let cards: OwnedCard[] = [];
const listeners = new Set<() => void>();

function emit() {
  cards = [...cards];
  listeners.forEach((l) => l());
  void set(KEY, cards);
}

export const ready: Promise<void> = get<OwnedCard[]>(KEY).then((saved) => {
  cards = saved ?? [];
  listeners.forEach((l) => l());
});

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
  const existing = cards.find((c) => c.id === card.id);
  if (existing) {
    // Offline index reads lack price/legality; don't let blanks wipe known values.
    const known = Object.fromEntries(Object.entries(card).filter(([, v]) => v !== undefined));
    cards = cards.map((c) => (c.id === card.id ? { ...c, ...known, qty: c.qty + qty } : c));
  } else {
    cards = [{ ...card, qty, addedAt: Date.now() }, ...cards];
  }
  emit();
  return cards.find((c) => c.id === card.id)!;
}

/**
 * Fill in price, legality and rarity from TCGdex after an offline scan.
 * Best effort: without a connection the card just keeps what the index knew.
 */
export async function enrichCard(id: string) {
  try {
    const full = await getCard(id);
    if (!cards.some((c) => c.id === id)) return;
    cards = cards.map((c) => (c.id === id ? { ...c, ...full, qty: c.qty, addedAt: c.addedAt } : c));
    emit();
  } catch {
    /* offline */
  }
}

export function setQty(id: string, qty: number) {
  cards = qty <= 0 ? cards.filter((c) => c.id !== id) : cards.map((c) => (c.id === id ? { ...c, qty } : c));
  emit();
}

export function replaceCollection(next: OwnedCard[]) {
  cards = next;
  emit();
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
