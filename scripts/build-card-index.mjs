#!/usr/bin/env node
// Builds the offline card index the scanner matches camera frames against:
// one image fingerprint per card plus the metadata needed to identify it
// (name, number, set, category, regulation mark). Data and images from TCGdex.
//
//   npm run index                      # Scarlet & Violet, Mega Evolution, Sword & Shield
//   SERIES=sv,me npm run index         # fewer eras = smaller download for the app
//
// Incremental: cards already in public/card-index are reused, so after the
// first run only newly released cards get downloaded.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { DIMS, fingerprint, SRC_H, SRC_W } from "../src/lib/fingerprint.ts";

const API = process.env.TCGDEX_API ?? "https://api.tcgdex.net/v2/en";
const SERIES = (process.env.SERIES ?? "sv,me,swsh").split(",").map((s) => s.trim()).filter(Boolean);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8);
const OUT = new URL("../public/card-index/", import.meta.url);
const CATEGORY = { Pokemon: "P", Trainer: "T", Energy: "E" };

async function get(url, as = "json") {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url.startsWith("http") ? url : API + url);
      if (res.ok) return as === "json" ? res.json() : Buffer.from(await res.arrayBuffer());
      if (res.status === 404) return null;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt >= 4) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

async function pool(items, fn) {
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const item = items[next++];
        await fn(item);
        if (++done % 100 === 0) console.log(`  ${done}/${items.length}`);
      }
    }),
  );
}

async function loadExisting(series) {
  try {
    const meta = JSON.parse(await readFile(new URL(`${series}.json`, OUT), "utf8"));
    const bin = await readFile(new URL(`${series}.bin`, OUT));
    if (meta.dims !== DIMS) return new Map(); // fingerprint format changed: rebuild
    const vecs = new Int8Array(bin.buffer, bin.byteOffset, bin.byteLength);
    const byId = new Map();
    meta.cards.forEach((row, i) => byId.set(row[0], { row, vec: vecs.slice(i * DIMS, (i + 1) * DIMS) }));
    for (const row of meta.extra ?? []) byId.set(row[0], { row, vec: null });
    return byId;
  } catch {
    return new Map();
  }
}

async function buildSeries(seriesId) {
  const series = await get(`/series/${seriesId}`);
  if (!series) throw new Error(`unknown series ${seriesId}`);
  const existing = await loadExisting(seriesId);
  const sets = {};
  const todo = [];
  const results = new Map(); // id -> { row, vec }

  for (const s of series.sets ?? []) {
    const set = await get(`/sets/${s.id}`);
    if (!set?.cards?.length) continue;
    const withImage = set.cards.find((c) => c.image);
    sets[set.id] = {
      n: set.name,
      o: set.cardCount?.official ?? 0,
      ...(withImage ? { img: withImage.image.slice(0, withImage.image.lastIndexOf("/")) } : {}),
    };
    for (const c of set.cards) {
      const prev = existing.get(c.id);
      if (prev && (prev.vec || !c.image)) results.set(c.id, prev);
      else todo.push({ ...c, setId: set.id });
    }
  }

  console.log(`${series.name}: ${Object.keys(sets).length} sets, ${results.size} cached, ${todo.length} to fetch`);
  let failed = 0;
  await pool(todo, async (c) => {
    try {
      const d = await get(`/cards/${encodeURIComponent(c.id)}`);
      const row = [c.id, c.name, c.localId, c.setId, CATEGORY[d?.category] ?? "P", d?.regulationMark ?? ""];
      let vec = null;
      if (c.image) {
        const img = await get(`${c.image}/low.webp`, "buffer");
        if (img) {
          const raw = await sharp(img).resize(SRC_W, SRC_H, { fit: "fill" }).ensureAlpha().raw().toBuffer();
          vec = fingerprint(raw);
        }
      }
      results.set(c.id, { row, vec });
    } catch (err) {
      failed++;
      console.warn(`  skip ${c.id}: ${err.message}`);
    }
  });

  // Stable order so unchanged data produces byte-identical files (no git churn).
  const all = [...results.values()].sort((a, b) => (a.row[0] < b.row[0] ? -1 : 1));
  const withVec = all.filter((r) => r.vec);
  const bin = new Int8Array(withVec.length * DIMS);
  withVec.forEach((r, i) => bin.set(r.vec, i * DIMS));
  const meta = {
    series: seriesId,
    name: series.name,
    dims: DIMS,
    sets,
    cards: withVec.map((r) => r.row),
    extra: all.filter((r) => !r.vec).map((r) => r.row), // no image: still findable by number/name
  };
  await writeFile(new URL(`${seriesId}.json`, OUT), JSON.stringify(meta));
  await writeFile(new URL(`${seriesId}.bin`, OUT), bin);
  console.log(`${series.name}: ${withVec.length} fingerprinted, ${meta.extra.length} without image, ${failed} failed`);
  return { id: seriesId, name: series.name, count: withVec.length + meta.extra.length };
}

await mkdir(OUT, { recursive: true });
const built = [];
for (const s of SERIES) {
  try {
    built.push(await buildSeries(s));
  } catch (err) {
    console.error(`series ${s} failed: ${err.message}`);
  }
}
if (!built.length) process.exit(1);
await writeFile(new URL("manifest.json", OUT), JSON.stringify({ dims: DIMS, series: built }, null, 1) + "\n");
