// Ranks meta decks by how strong they are AND how much of each one the
// collection already covers.
import type { MetaDeck, OwnedCard } from "./types";
import { isBasicEnergy, normalizeName } from "./text";

export interface AdvisorOptions {
  /** Only count cards legal in Standard. */
  standardOnly: boolean;
  /** Regulation marks treated as Standard-legal when the database is silent. */
  legalMarks: string[];
  /** Basic energy is cheap and everywhere; assume you have enough. */
  assumeBasicEnergy: boolean;
}

export const DEFAULT_OPTIONS: AdvisorOptions = {
  standardOnly: true,
  legalMarks: ["H", "I", "J"],
  assumeBasicEnergy: true,
};

export interface DeckLine {
  name: string;
  category: string;
  set?: string;
  number?: string;
  need: number;
  have: number;
  inclusion: number;
}

export interface DeckPlan {
  deck: MetaDeck;
  lines: DeckLine[];
  owned: number; // cards covered, out of `total`
  total: number;
  completion: number; // 0..1 raw
  weightedCompletion: number; // 0..1, core cards count more than flex slots
  missingStar: boolean; // missing the Pokémon the deck is named after
  buildScore: number; // 0..100, what we sort by
}

export function isLegal(card: OwnedCard, opts: AdvisorOptions): boolean {
  if (!opts.standardOnly) return true;
  if (card.category === "Energy" && isBasicEnergy(card.name)) return true;
  if (typeof card.legalStandard === "boolean") return card.legalStandard;
  return !!card.regulationMark && opts.legalMarks.includes(card.regulationMark.toUpperCase());
}

/** name -> copies owned (across every printing). */
export function countByName(collection: OwnedCard[], opts: AdvisorOptions): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of collection) {
    if (!isLegal(c, opts)) continue;
    const key = normalizeName(c.name);
    counts.set(key, (counts.get(key) ?? 0) + c.qty);
  }
  return counts;
}

// Limitless names archetypes after their main Pokémon without suffixes
// ("Dragapult", "N's Zoroark", "Ogerpon Meganium Arboliva"), while the cards
// are "Dragapult ex", "Mega Lopunny ex". Match on the Pokémon's last word.
const SUFFIX = /\s+(ex|v|vstar|vmax|v-union|gx|break)$/;

function starKey(cardName: string, deckWords: Set<string>): string | null {
  const base = normalizeName(cardName).replace(SUFFIX, "");
  const last = base.split(" ").at(-1) ?? "";
  return deckWords.has(last) ? last : null;
}

export function planDeck(deck: MetaDeck, owned: Map<string, number>, opts: AdvisorOptions): DeckPlan {
  // The same name can appear on two lines (two printings); share copies fairly.
  const remaining = new Map(owned);
  const lines: DeckLine[] = deck.list.map((card) => {
    const key = normalizeName(card.name);
    let have: number;
    if (card.category === "Energy" && opts.assumeBasicEnergy && isBasicEnergy(card.name)) {
      have = card.count;
    } else {
      have = Math.min(card.count, remaining.get(key) ?? 0);
      remaining.set(key, (remaining.get(key) ?? 0) - have);
    }
    return {
      name: card.name,
      category: card.category,
      set: card.set,
      number: card.number,
      need: card.count,
      have,
      inclusion: card.inclusion,
    };
  });

  const total = lines.reduce((s, l) => s + l.need, 0) || 60;
  const ownedCount = lines.reduce((s, l) => s + l.have, 0);
  // Weight each copy by how standard the card is in this archetype: a card in
  // every list matters more than a tech someone tried once.
  const weight = (l: DeckLine) => 0.25 + l.inclusion;
  const wNeed = lines.reduce((s, l) => s + l.need * weight(l), 0) || 1;
  const wHave = lines.reduce((s, l) => s + l.have * weight(l), 0);
  const weightedCompletion = wHave / wNeed;

  // Missing the star = owning no copy of any card for one of the named Pokémon.
  const deckWords = new Set(normalizeName(deck.name).split(/[\s/|]+/));
  const starHave = new Map<string, number>();
  for (const l of lines) {
    const key = l.category === "Pokemon" ? starKey(l.name, deckWords) : null;
    if (key) starHave.set(key, (starHave.get(key) ?? 0) + l.have);
  }
  const missingStar = [...starHave.values()].some((have) => have === 0);

  // Half a deck doesn't play half as well, so completion is squared. Missing
  // the namesake Pokémon is close to not having the deck at all.
  const strength = Math.max(deck.score, 1) / 100;
  let buildScore = 100 * strength * weightedCompletion ** 2;
  if (missingStar) buildScore *= 0.35;

  return {
    deck,
    lines,
    owned: ownedCount,
    total,
    completion: ownedCount / total,
    weightedCompletion,
    missingStar,
    buildScore,
  };
}

export function rankDecks(decks: MetaDeck[], collection: OwnedCard[], opts: AdvisorOptions = DEFAULT_OPTIONS) {
  const owned = countByName(collection, opts);
  return decks.map((d) => planDeck(d, owned, opts)).sort((a, b) => b.buildScore - a.buildScore);
}

/** Cards to pick up, most important first. */
export function shoppingList(plan: DeckPlan): DeckLine[] {
  return plan.lines
    .filter((l) => l.have < l.need)
    .sort((a, b) => b.inclusion - a.inclusion || b.need - b.have - (a.need - a.have));
}
