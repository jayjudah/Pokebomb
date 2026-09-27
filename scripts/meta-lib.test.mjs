import { describe, expect, it } from "vitest";
import { aggregate } from "./meta-lib.mjs";

function list(star, extra = []) {
  return {
    pokemon: [{ count: 4, name: star, set: "TWM", number: "130" }],
    trainer: [{ count: 4, name: "Arven" }, ...extra],
    energy: [{ count: 52 - extra.reduce((s, c) => s + c.count, 0), name: "Basic {P} Energy" }],
  };
}

function player(deckId, star, placing, wins, losses, extra) {
  return {
    placing,
    record: { wins, losses, ties: 0 },
    deck: { id: deckId, name: star },
    decklist: list(star, extra),
  };
}

describe("aggregate", () => {
  const standings = [
    player("drag", "Dragapult ex", 1, 7, 0, [{ count: 1, name: "Tech" }]),
    player("drag", "Dragapult ex", 2, 6, 1),
    player("drag", "Dragapult ex", 9, 3, 3),
    player("drag", "Dragapult ex", 12, 2, 4),
    player("drag", "Dragapult ex", 20, 1, 5),
    player("pika", "Pikachu ex", 3, 1, 6),
    player("pika", "Pikachu ex", 4, 1, 6),
    player("pika", "Pikachu ex", 5, 0, 7),
    player("pika", "Pikachu ex", 6, 0, 7),
    player("pika", "Pikachu ex", 7, 0, 7),
  ];
  const decks = aggregate([{ tournament: { id: "t1", name: "T", date: "2026-09-01", players: 64 }, standings }]);

  it("ranks the winning archetype first", () => {
    expect(decks.map((d) => d.id)).toEqual(["drag", "pika"]);
  });

  it("uses the best finisher's list and reports card inclusion", () => {
    const tech = decks[0].list.find((c) => c.name === "Tech");
    expect(tech).toMatchObject({ count: 1, inclusion: 0.2 });
    expect(decks[0].list.find((c) => c.name === "Arven")?.inclusion).toBe(1);
  });

  it("computes share and win rate", () => {
    expect(decks[0].share).toBe(0.5);
    expect(decks[0].winRate).toBeCloseTo(19 / 32, 3);
  });
});
