// Scanner accuracy on REAL card images. Downloads a sample of card scans
// from TCGdex, turns each into a fake phone photo (dim/warm light, colour
// cast, noise, glare, off-centre), and runs it through the same matching
// and decision code the app uses, against the full offline index.
//
// Also photographs cards that are NOT in the index (older eras) to measure
// how often the scanner would wrongly auto-add something.
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import { CARD_H, CARD_W, photograph } from "../src/test/syntheticCards";

const realFetch = globalThis.fetch;
// loadIndex() fetches /card-index/* from the app; serve those from disk.
vi.stubGlobal("fetch", async (url: string) =>
  url.startsWith("/card-index/") ? new Response(await readFile(`public${url}`)) : realFetch(url),
);

const { loadIndex, queriesFor, searchImage, setOfficialCount, indexSize } = await import("../src/lib/cardIndex");
const { decideFromImage, decideWithOcr } = await import("../src/lib/matchDecision");
const { normalizeName } = await import("../src/lib/text");

const SAMPLE = Number(process.env.EVAL_SAMPLE ?? 300);
const SWEEP: [accept: number, margin: number][] = [[0.7, 0.1], [0.75, 0.1], [0.8, 0.1], [0.8, 0.06], [0.85, 0.06]];
type Hits = ReturnType<typeof searchImage>;
const inRuns: { id: string; name: string; hits: Hits }[] = [];
const outRuns: { name: string; hits: Hits }[] = [];
const OUTSIDE = Number(process.env.EVAL_OUTSIDE ?? 100);

async function photo(imageUrl: string, seed: number) {
  const res = await realFetch(`${imageUrl}/low.webp`);
  if (!res.ok) return null;
  const raw = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize(CARD_W, CARD_H, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();
  return photograph(new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength), seed);
}

function identify(p: { px: Uint8ClampedArray; w: number; h: number }) {
  const hits = searchImage(queriesFor(p.px, p.w, p.h, { x: 0, y: 0, w: p.w, h: p.h }));
  // No OCR here, so this is the worst case for the tie-break step.
  const d = decideFromImage(hits) ?? decideWithOcr(hits, {}, setOfficialCount);
  return { hits, d };
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

it("identifies real cards from simulated phone photos", async () => {
  expect(await loadIndex()).toBe(true);
  const series = ["sv", "me", "swsh"];
  const all: { id: string; name: string; img: string }[] = [];
  for (const s of series) {
    const m = JSON.parse(await readFile(`public/card-index/${s}.json`, "utf8"));
    for (const r of m.cards) if (m.sets[r[3]]?.img) all.push({ id: r[0], name: r[1], img: `${m.sets[r[3]].img}/${r[2]}` });
  }
  console.log(`index: ${indexSize()} cards`);
  const sample = Array.from({ length: SAMPLE }, (_, t) => all[(t * 7919 + 13) % all.length]);

  const tally = { exact: 0, rightName: 0, autoWrong: 0, asked: 0, nothing: 0, fetchFail: 0 };
  const wrong: string[] = [];
  const topScores: number[] = [];
  await pool(sample, 8, async (c) => {
    const p = await photo(c.img, c.id.length * 97 + c.name.length);
    if (!p) return void tally.fetchFail++;
    const { hits, d } = identify(p);
    inRuns.push({ id: c.id, name: c.name, hits });
    const selfHit = hits.find((h) => h.card.id === c.id);
    if (selfHit) topScores.push(selfHit.score);
    if (!d) return void tally.nothing++;
    const auto = d.confidence >= 0.7;
    if (!auto) return void tally.asked++;
    if (d.card.id === c.id) tally.exact++;
    else if (normalizeName(d.card.name) === normalizeName(c.name)) tally.rightName++;
    else {
      tally.autoWrong++;
      wrong.push(`${c.id} ${c.name} -> ${d.card.id} ${d.card.name} (${d.why})`);
    }
  });
  const n = SAMPLE - tally.fetchFail;
  const pct = (x: number) => `${((100 * x) / n).toFixed(1)}%`;
  const sorted = [...topScores].sort((a, b) => a - b);
  console.log(`IN INDEX (n=${n}): auto-added exact ${pct(tally.exact)}, right name/other printing ${pct(tally.rightName)}, ` +
    `WRONG auto-add ${pct(tally.autoWrong)}, asked user ${pct(tally.asked)}, no match ${pct(tally.nothing)}`);
  console.log(`true-card score p10=${sorted[Math.floor(sorted.length * 0.1)]?.toFixed(3)} median=${sorted[Math.floor(sorted.length / 2)]?.toFixed(3)}`);
  if (wrong.length) console.log("wrong:\n  " + wrong.slice(0, 20).join("\n  "));

  // Cards from an era the index doesn't cover (Sun & Moon): should never auto-add.
  const sm = (await (await realFetch("https://api.tcgdex.net/v2/en/series/sm")).json()) as { sets: { id: string }[] };
  const outside: { img: string; name: string }[] = [];
  for (const s of sm.sets.slice(0, 6)) {
    const set = (await (await realFetch(`https://api.tcgdex.net/v2/en/sets/${s.id}`)).json()) as { cards: { image?: string; name: string }[] };
    for (const c of set.cards) if (c.image) outside.push({ img: c.image, name: c.name });
  }
  const outSample = Array.from({ length: OUTSIDE }, (_, t) => outside[(t * 131 + 7) % outside.length]);
  let falseAdd = 0, falseAddSameName = 0, outN = 0;
  await pool(outSample, 8, async (c) => {
    const p = await photo(c.img, c.name.length * 31);
    if (!p) return;
    outN++;
    const { d, hits } = identify(p);
    outRuns.push({ name: c.name, hits });
    if (d && d.confidence >= 0.7) {
      if (normalizeName(d.card.name) === normalizeName(c.name)) falseAddSameName++;
      else falseAdd++;
    }
  });
  console.log(`NOT IN INDEX (n=${outN}): auto-added a wrong card ${falseAdd}, auto-added same-name reprint ${falseAddSameName}`);

  // Same photos, different thresholds: (in-index) auto/right, auto/wrong; (outside) wrong auto-adds.
  for (const [accept, margin] of SWEEP) {
    const decide = (hits: Hits) => decideFromImage(hits, accept, margin) ?? decideWithOcr(hits, {}, setOfficialCount, accept);
    let right = 0, wrongIn = 0, asked = 0, wrongOut = 0;
    for (const r of inRuns) {
      const d = decide(r.hits);
      if (!d || d.confidence < 0.7) asked++;
      else if (normalizeName(d.card.name) === normalizeName(r.name)) right++;
      else wrongIn++;
    }
    for (const r of outRuns) {
      const d = decide(r.hits);
      if (d && d.confidence >= 0.7 && normalizeName(d.card.name) !== normalizeName(r.name)) wrongOut++;
    }
    console.log(`SWEEP accept=${accept} margin=${margin}: in-index right ${right}/${inRuns.length}, wrong ${wrongIn}, asked/OCR ${asked}; outside wrong adds ${wrongOut}/${outRuns.length}`);
  }
  const outTop = outRuns.map((r) => r.hits[0]?.score ?? 0).sort((a, b) => a - b);
  console.log(`outside top score p50=${outTop[Math.floor(outTop.length / 2)]?.toFixed(3)} p90=${outTop[Math.floor(outTop.length * 0.9)]?.toFixed(3)} max=${outTop.at(-1)?.toFixed(3)}`);

  expect(tally.autoWrong / n).toBeLessThan(0.05);
});
