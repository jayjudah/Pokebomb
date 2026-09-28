// Runs against the real offline card index in public/card-index.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { cardsNamed, setIndexData } from "./cardIndex";
import { combine, detectColumns, parseCsv, previewCsv } from "./csvImport";

beforeAll(() => {
  const parts = ["sv", "me", "swsh"].map((s) => {
    const bin = readFileSync(`public/card-index/${s}.bin`);
    return {
      meta: JSON.parse(readFileSync(`public/card-index/${s}.json`, "utf8")),
      vecs: new Int8Array(bin.buffer, bin.byteOffset, bin.byteLength),
    };
  });
  expect(setIndexData(parts)).toBe(true);
});

describe("parseCsv", () => {
  it("handles quotes, commas and newlines inside fields, and a BOM", () => {
    expect(parseCsv('﻿Name,Qty\n"Boss\'s Orders, promo",2\r\n"Line\nbreak","say ""hi"""\n')).toEqual([
      ["Name", "Qty"],
      ["Boss's Orders, promo", "2"],
      ["Line\nbreak", 'say "hi"'],
    ]);
  });
  it("detects semicolon and tab separated files", () => {
    expect(parseCsv("Name;Qty\nIono;2")).toEqual([["Name", "Qty"], ["Iono", "2"]]);
    expect(parseCsv("Name\tQty\nIono\t2")).toEqual([["Name", "Qty"], ["Iono", "2"]]);
  });
});

describe("detectColumns", () => {
  it("recognises common header spellings", () => {
    expect(detectColumns(["Quantity", "Product Name", "Set Name", "Card Number"])).toEqual({ qty: 0, name: 1, set: 2, number: 3 });
    expect(detectColumns(["Count", "Card", "Expansion", "No."])).toEqual({ qty: 0, name: 1, set: 2, number: 3 });
  });
});

describe("previewCsv on real card data", () => {
  it("round-trips this app's own export", () => {
    const csv = '"Quantity","Name","Set","Number","Category","Regulation","TCGdex ID"\n"3","Dragapult ex","Twilight Masquerade","130","Pokemon","H","sv06-130"';
    const [line] = previewCsv(csv).lines;
    expect(line).toMatchObject({ qty: 3, how: "id", guessed: false });
    expect(line.card?.id).toBe("sv06-130");
  });

  it("reads a TCGplayer-style export (set name + number/total)", () => {
    const csv = [
      "Quantity,Name,Simple Name,Set,Card Number,Rarity,Condition",
      "2,Dragapult ex - 130/167,Dragapult ex,SV06: Twilight Masquerade,130/167,Double Rare,Near Mint",
      "1,Iono,Iono,SV02: Paldea Evolved,185/193,Uncommon,Near Mint",
    ].join("\n");
    const { lines } = previewCsv(csv);
    expect(lines.map((l) => [l.card?.id, l.qty, l.how])).toEqual([
      ["sv06-130", 2, "set+number"],
      ["sv02-185", 1, "set+number"],
    ]);
  });

  it("picks the exact printing from number/total without a set column", () => {
    const { lines } = previewCsv("Name,Number\nDragapult ex,073/131");
    expect(lines[0].card?.id).toBe("sv08.5-073");
  });

  it("falls back to name only and says the printing is a guess", () => {
    const { lines } = previewCsv("Card,Count\nUltra Ball,4\nDragapult ex,1");
    expect(lines[0]).toMatchObject({ qty: 4, how: "name", guessed: true });
    expect(lines[0].card?.name).toBe("Ultra Ball");
    // The guess is the newest regular printing, not a rotated or secret-rare one.
    const marks = cardsNamed("Ultra Ball").map((c) => c.regulationMark ?? "");
    expect(lines[0].card?.regulationMark).toBe(marks.sort().at(-1));
    expect(Number(lines[0].card?.localId)).toBeLessThanOrEqual(lines[0].card?.setOfficialCount ?? 0);
  });

  it("narrows a name by set when there's no number", () => {
    const { lines } = previewCsv("Name,Set\nUltra Ball,Paldean Fates");
    expect(lines[0].card?.id).toBe("sv04.5-091");
  });

  it("reports rows it can't match and skips zero quantities", () => {
    const { lines } = previewCsv("Name,Quantity\nNot A Real Card,1\nIono,0\nIono,2");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ card: null, how: "none", line: 2 });
    expect(lines[1].card?.name).toBe("Iono");
  });

  it("explains a file with no usable columns", () => {
    expect(previewCsv("Foo,Bar\n1,2").error).toMatch(/card name column/);
  });

  it("combines duplicate rows (e.g. different conditions)", () => {
    const { lines } = previewCsv("Name,Set,Number,Qty\nIono,Paldea Evolved,185,1\nIono,Paldea Evolved,185,2");
    expect(combine(lines)).toEqual([{ card: expect.objectContaining({ id: "sv02-185" }), qty: 3 }]);
  });
});
