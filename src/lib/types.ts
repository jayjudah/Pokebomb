export type Category = "Pokemon" | "Trainer" | "Energy";

/** A specific printing of a card, as returned by the card database. */
export interface CardInfo {
  id: string; // TCGdex id, e.g. "sv06-130"
  name: string;
  localId: string; // number within the set, e.g. "130"
  setId: string;
  setName: string;
  setOfficialCount?: number;
  category: Category;
  regulationMark?: string;
  legalStandard?: boolean;
  rarity?: string;
  image?: string; // base URL; append /low.webp or /high.webp
  price?: number; // USD market price when the database has one
}

export interface OwnedCard extends CardInfo {
  qty: number;
  addedAt: number;
}

export interface MetaCard {
  count: number; // copies in the representative list
  name: string;
  category: Category;
  set?: string; // PTCGO set code from Limitless, e.g. "TWM"
  number?: string;
  inclusion: number; // 0..1 share of this archetype's lists that play the card
}

export interface MetaDeck {
  id: string;
  name: string;
  players: number;
  share: number; // 0..1 of all players in the sample
  winRate: number; // 0..1, ties count half
  topCutRate: number; // 0..1 of players who finished top 8
  score: number; // 0..100 combined strength
  icons?: string[];
  list: MetaCard[];
}

export interface MetaSnapshot {
  source: string;
  generatedAt: string;
  format: string;
  sample: { tournaments: number; players: number; from: string; to: string };
  isSample?: boolean;
  decks: MetaDeck[];
}
