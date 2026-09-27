#!/usr/bin/env node
// Pulls recent Standard tournaments from the Limitless TCG API and writes
// public/meta.json. Runs daily in CI (see .github/workflows/deploy.yml).
//
//   npm run meta                  # last 30 days, events with 32+ players
//   DAYS=14 MIN_EVENT_PLAYERS=64 npm run meta
//   LIMITLESS_API_KEY=... npm run meta   # optional, raises rate limits
import { writeFile } from "node:fs/promises";
import { aggregate } from "./meta-lib.mjs";

const API = "https://play.limitlesstcg.com/api";
const DAYS = Number(process.env.DAYS ?? 30);
const MIN_EVENT_PLAYERS = Number(process.env.MIN_EVENT_PLAYERS ?? 32);
const MAX_EVENTS = Number(process.env.MAX_EVENTS ?? 40);
const OUT = new URL("../public/meta.json", import.meta.url);

const headers = { Accept: "application/json" };
if (process.env.LIMITLESS_API_KEY) headers["X-Access-Key"] = process.env.LIMITLESS_API_KEY;

async function get(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path, { headers });
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} ${path}`);
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  throw new Error(`gave up on ${path}`);
}

const since = new Date(Date.now() - DAYS * 86400_000);
const tournaments = [];
for (let page = 1; page <= 10 && tournaments.length < MAX_EVENTS; page++) {
  const batch = await get(`/tournaments?game=PTCG&format=STANDARD&limit=50&page=${page}`);
  if (!batch.length) break;
  for (const t of batch) {
    if (new Date(t.date) < since) continue;
    if ((t.players ?? 0) >= MIN_EVENT_PLAYERS) tournaments.push(t);
  }
  if (new Date(batch.at(-1).date) < since) break;
}
tournaments.splice(MAX_EVENTS);
if (!tournaments.length) {
  console.error("No qualifying tournaments found; leaving meta.json untouched.");
  process.exit(1);
}

const events = [];
for (const t of tournaments) {
  try {
    events.push({ tournament: t, standings: await get(`/tournaments/${t.id}/standings`) });
    process.stdout.write(".");
  } catch (err) {
    console.warn(`\nskipping ${t.name}: ${err.message}`);
  }
}
console.log();

const decks = aggregate(events);
const dates = tournaments.map((t) => t.date).sort();
const snapshot = {
  source: "Limitless TCG online tournaments (play.limitlesstcg.com)",
  generatedAt: new Date().toISOString(),
  format: "Standard",
  sample: {
    tournaments: events.length,
    players: events.reduce((s, e) => s + e.standings.length, 0),
    from: dates[0].slice(0, 10),
    to: dates.at(-1).slice(0, 10),
  },
  decks,
};
await writeFile(OUT, JSON.stringify(snapshot, null, 1) + "\n");
console.log(`Wrote ${decks.length} archetypes from ${events.length} tournaments to public/meta.json`);
