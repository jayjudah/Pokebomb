import { describe, expect, it, vi } from "vitest";

vi.mock("idb-keyval", () => ({ get: async () => [], set: async () => {} }));
vi.mock("./cardDb", () => ({ getCard: async () => ({}) }));

const { addCard, getCollection } = await import("./collection");

describe("addCard", () => {
  it("keeps known details when an offline scan adds another copy", () => {
    const base = { id: "sv06-130", name: "Dragapult ex", localId: "130", setId: "sv06", setName: "TWM", category: "Pokemon" as const };
    addCard({ ...base, image: "https://img/130", price: 4.5 });
    addCard({ ...base, image: undefined });
    const [c] = getCollection();
    expect(c).toMatchObject({ qty: 2, image: "https://img/130", price: 4.5 });
  });
});
