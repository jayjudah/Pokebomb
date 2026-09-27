import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, isLegal, rankDecks, shoppingList } from "./deckAdvisor";
import type { MetaDeck, OwnedCard } from "./types";

function owned(name: string, qty: number, extra: Partial<OwnedCard> = {}): OwnedCard {
  return {
    id: `${name}-${qty}`,
    name,
    localId: "1",
    setId: "x",
    setName: "X",
    category: "Pokemon",
    regulationMark: "I",
    qty,
    addedAt: 0,
    ...extra,
  };
}

const dragapult: MetaDeck = {
  id: "dragapult",
  name: "Dragapult ex",
  players: 100,
  share: 0.15,
  winRate: 0.55,
  topCutRate: 0.2,
  score: 90,
  list: [
    { count: 4, name: "Dreepy", category: "Pokemon", inclusion: 1 },
    { count: 3, name: "Drakloak", category: "Pokemon", inclusion: 1 },
    { count: 2, name: "Dragapult ex", category: "Pokemon", inclusion: 1 },
    { count: 4, name: "Arven", category: "Trainer", inclusion: 1 },
    { count: 1, name: "Tech Card", category: "Trainer", inclusion: 0.1 },
    { count: 46, name: "Basic Psychic Energy", category: "Energy", inclusion: 1 },
  ],
};

const weaker: MetaDeck = {
  id: "rogue",
  name: "Pikachu ex",
  players: 10,
  share: 0.01,
  winRate: 0.48,
  topCutRate: 0.05,
  score: 30,
  list: [
    { count: 4, name: "Pikachu ex", category: "Pokemon", inclusion: 1 },
    { count: 56, name: "Basic {L} Energy", category: "Energy", inclusion: 1 },
  ],
};

describe("rankDecks", () => {
  it("prefers a complete weaker deck over a strong deck missing its star", () => {
    const collection = [owned("Pikachu ex", 4), owned("Dreepy", 4), owned("Drakloak", 3), owned("Arven", 4, { category: "Trainer" })];
    const [first, second] = rankDecks([dragapult, weaker], collection);
    expect(first.deck.id).toBe("rogue");
    expect(first.completion).toBe(1);
    expect(second.missingStar).toBe(true);
  });

  it("ranks the strong deck first once you own it", () => {
    const collection = [
      owned("Pikachu ex", 4),
      owned("Dreepy", 4),
      owned("Drakloak", 3),
      owned("Dragapult ex", 2),
      owned("Arven", 4, { category: "Trainer" }),
    ];
    const [first] = rankDecks([dragapult, weaker], collection);
    expect(first.deck.id).toBe("dragapult");
    expect(shoppingList(first).map((l) => l.name)).toEqual(["Tech Card"]);
  });

  it("does not count rotated cards in Standard", () => {
    const collection = [owned("Dragapult ex", 2, { regulationMark: "F", legalStandard: undefined })];
    const [plan] = rankDecks([dragapult], collection);
    expect(plan.lines.find((l) => l.name === "Dragapult ex")?.have).toBe(0);
  });

  it("trusts the database's legality flag over the regulation mark", () => {
    expect(isLegal(owned("A", 1, { regulationMark: "F", legalStandard: true }), DEFAULT_OPTIONS)).toBe(true);
    expect(isLegal(owned("A", 1, { regulationMark: "I", legalStandard: false }), DEFAULT_OPTIONS)).toBe(false);
  });

  it("finds the star Pokémon from Limitless-style deck names", () => {
    const deck: MetaDeck = {
      ...dragapult,
      id: "ogerpon",
      name: "Ogerpon Meganium",
      list: [
        { count: 3, name: "Teal Mask Ogerpon ex", category: "Pokemon", inclusion: 1 },
        { count: 2, name: "Chikorita", category: "Pokemon", inclusion: 1 },
        { count: 2, name: "Meganium", category: "Pokemon", inclusion: 1 },
        { count: 53, name: "Grass Energy", category: "Energy", inclusion: 1 },
      ],
    };
    expect(rankDecks([deck], [owned("Teal Mask Ogerpon ex", 3), owned("Chikorita", 2)])[0].missingStar).toBe(true);
    expect(
      rankDecks([deck], [owned("Teal Mask Ogerpon ex", 1), owned("Meganium", 1)])[0].missingStar,
    ).toBe(false);
    expect(rankDecks([{ ...dragapult, name: "Dragapult" }], [])[0].missingStar).toBe(true);
  });

  it("merges copies across printings", () => {
    const collection = [owned("Dreepy", 2, { id: "a" }), owned("Dreepy", 2, { id: "b" })];
    const [plan] = rankDecks([dragapult], collection);
    expect(plan.lines.find((l) => l.name === "Dreepy")?.have).toBe(4);
  });
});
