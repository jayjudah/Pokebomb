import { describe, expect, it } from "vitest";
import { parseCollectorNumber, parseName } from "./ocrParse";
import { isBasicEnergy, normalizeName, similarity } from "./text";

describe("parseCollectorNumber", () => {
  it("reads a clean number", () => {
    expect(parseCollectorNumber("G  EN  130/167 ★")).toEqual({ number: "130", total: 167 });
  });
  it("strips leading zeros and tolerates spaces", () => {
    expect(parseCollectorNumber("025 / 198")).toEqual({ number: "25", total: 198 });
  });
  it("fixes common OCR slips", () => {
    expect(parseCollectorNumber("O25l198")).toEqual({ number: "25", total: 198 });
  });
  it("ignores text without a number", () => {
    expect(parseCollectorNumber("Illus. Somebody")).toBeNull();
  });
});

describe("parseName", () => {
  it("drops stage and HP noise", () => {
    expect(parseName("STAGE 2\nDragapult ex  HP 320")).toBe("Dragapult ex");
  });
  it("keeps apostrophes", () => {
    expect(parseName("Boss's Orders")).toBe("Boss's Orders");
  });
});

describe("text helpers", () => {
  it("normalizes energy spellings", () => {
    expect(normalizeName("Basic {R} Energy")).toBe("fire energy");
    expect(normalizeName("Basic Fire Energy")).toBe("fire energy");
    expect(isBasicEnergy("Basic Psychic Energy")).toBe(true);
    expect(isBasicEnergy("Jet Energy")).toBe(false);
  });
  it("normalizes curly apostrophes and accents", () => {
    expect(normalizeName("Boss’s Orders")).toBe(normalizeName("Boss's Orders"));
    expect(normalizeName("Pokégear 3.0")).toBe("pokegear 3.0");
  });
  it("scores noisy OCR close to the real name", () => {
    expect(similarity("Dragapu1t ex", "Dragapult ex")).toBeGreaterThan(0.85);
    expect(similarity("Pikachu", "Dragapult ex")).toBeLessThan(0.5);
  });
});
