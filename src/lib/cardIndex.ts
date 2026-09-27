// The offline card database: every card's name, number, set and image
// fingerprint, built by scripts/build-card-index.mjs and shipped with the
// app. Lets the scanner identify cards by their picture, for free, offline.
import { cosineAt, DIMS, fingerprint, norm, resample, SRC_H, SRC_W } from "./fingerprint";
import { normalizeName, similarity } from "./text";
import type { CardInfo, Category } from "./types";

type Row = [id: string, name: string, localId: string, setId: string, cat: string, reg: string];

interface SeriesMeta {
  series: string;
  dims: number;
  sets: Record<string, { n: string; o: number; img?: string }>;
  cards: Row[];
  extra: Row[];
}

interface Manifest {
  dims: number;
  series: { id: string; name: string; count: number }[];
}

export interface IndexCard {
  id: string;
  name: string;
  localId: string;
  setId: string;
  category: Category;
  regulationMark?: string;
}

interface State {
  cards: IndexCard[]; // rows [0, vecCount) have fingerprints; the rest don't
  vecCount: number;
  vecs: Int8Array;
  norms: Float32Array;
  sets: Map<string, { name: string; official: number; img?: string }>;
  byNumber: Map<string, IndexCard[]>; // "130" -> cards with that collector number
}

const CAT: Record<string, Category> = { P: "Pokemon", T: "Trainer", E: "Energy" };
let state: State | null = null;
let loading: Promise<boolean> | null = null;

const numKey = (n: string) => (/^\d+$/.test(n) ? String(Number(n)) : n.toUpperCase());

export function indexSize(): number {
  return state?.cards.length ?? 0;
}

export function loadIndex(): Promise<boolean> {
  loading ??= (async () => {
    const base = `${import.meta.env.BASE_URL}card-index/`;
    const res = await fetch(`${base}manifest.json`);
    if (!res.ok) return false;
    const manifest: Manifest = await res.json();
    if (manifest.dims !== DIMS) return false;
    const parts = await Promise.all(
      manifest.series.map(async (s) => {
        const [meta, bin] = await Promise.all([
          fetch(`${base}${s.id}.json`).then((r) => r.json() as Promise<SeriesMeta>),
          fetch(`${base}${s.id}.bin`).then((r) => r.arrayBuffer()),
        ]);
        return { meta, vecs: new Int8Array(bin) };
      }),
    ).then((ps) =>
      // A half-updated cache (new .json, old .bin) would misalign every row.
      ps.filter((p) => p.meta.dims === DIMS && p.vecs.length === p.meta.cards.length * DIMS),
    );
    const toCard = (r: Row): IndexCard => ({
      id: r[0],
      name: r[1],
      localId: r[2],
      setId: r[3],
      category: CAT[r[4]] ?? "Pokemon",
      regulationMark: r[5] || undefined,
    });
    const withVec = parts.flatMap((p) => p.meta.cards.map(toCard));
    const without = parts.flatMap((p) => (p.meta.extra ?? []).map(toCard));
    const vecs = new Int8Array(withVec.length * DIMS);
    let off = 0;
    for (const p of parts) {
      vecs.set(p.vecs.subarray(0, p.meta.cards.length * DIMS), off);
      off += p.meta.cards.length * DIMS;
    }
    const norms = new Float32Array(withVec.length);
    for (let i = 0; i < norms.length; i++) norms[i] = norm(vecs, i * DIMS);
    const sets = new Map<string, { name: string; official: number; img?: string }>();
    for (const p of parts) for (const [id, s] of Object.entries(p.meta.sets)) sets.set(id, { name: s.n, official: s.o, img: s.img });
    const cards = [...withVec, ...without];
    const byNumber = new Map<string, IndexCard[]>();
    for (const c of cards) {
      const k = numKey(c.localId);
      byNumber.set(k, [...(byNumber.get(k) ?? []), c]);
    }
    state = { cards, vecCount: withVec.length, vecs, norms, sets, byNumber };
    return true;
  })().catch(() => {
    loading = null;
    return false;
  });
  return loading;
}

export function toCardInfo(c: IndexCard): CardInfo {
  const set = state?.sets.get(c.setId);
  return {
    id: c.id,
    name: c.name,
    localId: c.localId,
    setId: c.setId,
    setName: set?.name ?? c.setId,
    setOfficialCount: set?.official,
    category: c.category,
    regulationMark: c.regulationMark,
    image: set?.img ? `${set.img}/${c.localId}` : undefined,
  };
}

export function setOfficialCount(setId: string): number | undefined {
  return state?.sets.get(setId)?.official;
}

// Crops tried around the guide: 3 sizes x 5 positions. Tolerates a card that
// is placed off-centre or doesn't fill the frame.
const CROPS: [scale: number, dx: number, dy: number][] = [];
for (const s of [0.86, 0.93, 1]) {
  for (const [dx, dy] of [[0, 0], [0.035, 0], [-0.035, 0], [0, 0.035], [0, -0.035]]) CROPS.push([s, dx, dy]);
}

/** Fingerprints for each crop of `guide` inside an RGBA frame. */
export function queriesFor(
  px: ArrayLike<number>,
  w: number,
  h: number,
  guide: { x: number; y: number; w: number; h: number },
): Int8Array[] {
  return CROPS.map(([s, dx, dy]) => {
    const cw = guide.w * s;
    const ch = guide.h * s;
    const x = guide.x + (guide.w - cw) / 2 + dx * guide.w;
    const y = guide.y + (guide.h - ch) / 2 + dy * guide.h;
    return fingerprint(resample(px, w, h, x, y, cw, ch, SRC_W, SRC_H));
  });
}

export interface ImageHit {
  card: IndexCard;
  score: number; // cosine similarity, 1 = identical
}

/** Best-matching cards for a set of query fingerprints (max over queries). */
export function searchImage(queries: Int8Array[], k = 8): ImageHit[] {
  if (!state || !state.vecCount) return [];
  const { vecs, norms, vecCount } = state;
  const best = new Float32Array(vecCount).fill(-2);
  for (const q of queries) {
    const qn = norm(q);
    for (let r = 0; r < vecCount; r++) {
      const s = cosineAt(q, qn, vecs, r, norms[r]);
      if (s > best[r]) best[r] = s;
    }
  }
  const top: number[] = [];
  for (let r = 0; r < vecCount; r++) {
    if (top.length < k || best[r] > best[top[top.length - 1]]) {
      top.push(r);
      top.sort((a, b) => best[b] - best[a]);
      if (top.length > k) top.pop();
    }
  }
  return top.map((r) => ({ card: state!.cards[r], score: best[r] }));
}

/** Cards with this collector number, optionally in sets with this printed total. */
export function lookupNumber(number: string, total?: number): IndexCard[] {
  if (!state) return [];
  const hits = state.byNumber.get(numKey(number)) ?? [];
  return total ? hits.filter((c) => state!.sets.get(c.setId)?.official === total) : hits;
}

/** Closest card name in the index (one printing per name). */
export function lookupName(name: string): { card: IndexCard; score: number } | null {
  if (!state) return null;
  const target = normalizeName(name);
  let best: IndexCard | null = null;
  let bestScore = 0;
  const seen = new Set<string>();
  for (let i = state.cards.length - 1; i >= 0; i--) {
    const c = state.cards[i];
    const key = normalizeName(c.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const s = key === target ? 1 : similarity(name, c.name);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best ? { card: best, score: bestScore } : null;
}
