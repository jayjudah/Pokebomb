import { describe, expect, it } from "vitest";
import { decideFromImage, decideWithOcr } from "./matchDecision";
import type { IndexCard } from "./cardIndex";

const card = (id: string, name: string, localId: string, setId = id.split("-")[0]): IndexCard => ({
  id,
  name,
  localId,
  setId,
  category: "Pokemon",
});
const totals: Record<string, number> = { sv06: 167, sv01: 198, sv04: 182 };
const setTotal = (s: string) => totals[s];

describe("decideFromImage", () => {
  it("accepts a clear winner", () => {
    const d = decideFromImage([
      { card: card("sv06-130", "Dragapult ex", "130"), score: 0.82 },
      { card: card("sv01-5", "Pikachu", "5"), score: 0.55 },
    ]);
    expect(d?.card.id).toBe("sv06-130");
  });
  it("defers when two printings look the same", () => {
    expect(
      decideFromImage([
        { card: card("sv01-196", "Ultra Ball", "196"), score: 0.84 },
        { card: card("sv04-186", "Ultra Ball", "186"), score: 0.83 },
      ]),
    ).toBeNull();
  });
  it("ignores an empty table", () => {
    expect(decideFromImage([{ card: card("sv01-5", "Pikachu", "5"), score: 0.3 }])).toBeNull();
  });
});

describe("decideWithOcr", () => {
  const reprints = [
    { card: card("sv01-196", "Ultra Ball", "196"), score: 0.84 },
    { card: card("sv04-186", "Ultra Ball", "186"), score: 0.83 },
  ];
  it("uses the collector number to pick the printing", () => {
    expect(decideWithOcr(reprints, { number: "186", total: 182 }, setTotal)?.card.id).toBe("sv04-186");
  });
  it("still takes the name when OCR reads nothing", () => {
    const d = decideWithOcr(reprints, {}, setTotal);
    expect(d?.card.name).toBe("Ultra Ball");
    expect(d?.confidence).toBeGreaterThanOrEqual(0.8);
  });
  it("uses the name to separate different cards with similar pictures", () => {
    const d = decideWithOcr(
      [
        { card: card("sv06-128", "Dreepy", "128"), score: 0.66 },
        { card: card("sv06-129", "Drakloak", "129"), score: 0.65 },
      ],
      { name: "Drakloak" },
      setTotal,
    );
    expect(d?.card.id).toBe("sv06-129");
  });
  it("asks the user when nothing settles it", () => {
    const d = decideWithOcr(
      [
        { card: card("sv06-128", "Dreepy", "128"), score: 0.6 },
        { card: card("sv06-129", "Drakloak", "129"), score: 0.59 },
      ],
      {},
      setTotal,
    );
    expect(d?.confidence).toBeLessThan(0.7);
  });
});
