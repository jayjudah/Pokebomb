// Thin client for TCGdex (https://tcgdex.dev), a free, open Pokémon TCG
// database that needs no API key and allows browser requests.
import type { Category, CardInfo } from "./types";
import { similarity } from "./text";
import { indexSize, lookupName, lookupNumber, toCardInfo as indexCardInfo } from "./cardIndex";

const API = "https://api.tcgdex.net/v2/en";

interface SetBrief {
  id: string;
  name: string;
  cardCount: { total: number; official: number };
}

interface SetDetail extends SetBrief {
  releaseDate?: string;
  cards: { id: string; localId: string; name: string; image?: string }[];
}

interface CardDetail {
  id: string;
  localId: string;
  name: string;
  image?: string;
  category: Category;
  rarity?: string;
  regulationMark?: string;
  legal?: { standard?: boolean; expanded?: boolean };
  set: { id: string; name: string; cardCount?: { official?: number; total?: number } };
  pricing?: {
    tcgplayer?: Record<string, { marketPrice?: number } | string | undefined>;
    cardmarket?: { avg?: number; trend?: number };
  };
}

const memo = new Map<string, Promise<unknown>>();

async function get<T>(path: string): Promise<T> {
  let p = memo.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(API + path).then((r) => {
      if (!r.ok) throw new Error(`TCGdex ${r.status} for ${path}`);
      return r.json() as Promise<T>;
    });
    p.catch(() => memo.delete(path));
    memo.set(path, p);
  }
  return p;
}

export function imageUrl(card: Pick<CardInfo, "image">, size: "low" | "high" = "low"): string | undefined {
  return card.image ? `${card.image}/${size}.webp` : undefined;
}

function pickPrice(c: CardDetail): number | undefined {
  const tp = c.pricing?.tcgplayer;
  if (tp) {
    for (const v of Object.values(tp)) {
      if (v && typeof v === "object" && typeof v.marketPrice === "number") return v.marketPrice;
    }
  }
  return undefined;
}

function toCardInfo(c: CardDetail): CardInfo {
  return {
    id: c.id,
    name: c.name,
    localId: c.localId,
    setId: c.set.id,
    setName: c.set.name,
    setOfficialCount: c.set.cardCount?.official,
    category: c.category,
    regulationMark: c.regulationMark,
    legalStandard: c.legal?.standard,
    rarity: c.rarity,
    image: c.image,
    price: pickPrice(c),
  };
}

export async function getCard(id: string): Promise<CardInfo> {
  return toCardInfo(await get<CardDetail>(`/cards/${encodeURIComponent(id)}`));
}

export function listSets(): Promise<SetBrief[]> {
  return get<SetBrief[]>("/sets");
}

export function getSet(id: string): Promise<SetDetail> {
  return get<SetDetail>(`/sets/${encodeURIComponent(id)}`);
}

export async function searchByName(name: string, limit = 40) {
  const q = encodeURIComponent(name.trim());
  const res = await get<{ id: string; localId: string; name: string; image?: string }[]>(
    `/cards?name=${q}&pagination:itemsPerPage=${limit}`,
  );
  return res;
}

// "025" and "25" are the same collector number.
function sameNumber(a: string, b: string): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return a.toUpperCase() === b.toUpperCase();
}

export interface Match {
  card: CardInfo;
  confidence: number; // 0..1
}

/**
 * Turn what we read off a card ("Dragapult ex", "130/167") into a specific
 * printing. The printed denominator narrows the set down to a handful of
 * candidates; the name picks between them.
 */
export interface CardRead {
  name?: string;
  number?: string;
  total?: number;
}

// Same logic as the network path below, against the offline index.
function resolveLocal({ name, number, total }: CardRead): Match | null {
  if (number && total) {
    const hits = lookupNumber(number, total)
      .map((c) => ({ c, score: name ? similarity(name, c.name) : 0.5 }))
      .sort((a, b) => b.score - a.score);
    const best = hits[0];
    if (best) {
      const confidence = name ? best.score : hits.length === 1 ? 0.75 : 0.4;
      if (confidence >= 0.55) return { card: indexCardInfo(best.c), confidence };
    }
  }
  if (name && name.replace(/[^a-z]/gi, "").length >= 4) {
    const hit = lookupName(name);
    if (hit && hit.score >= 0.8) return { card: indexCardInfo(hit.card), confidence: Math.min(hit.score, 0.6) };
  }
  return null;
}

export async function resolveCard(read: CardRead): Promise<Match | null> {
  if (indexSize()) {
    const local = resolveLocal(read);
    if (local) return local;
    // Not in the index (brand-new set?): ask TCGdex directly.
  }
  const { name, number, total } = read;

  if (number && total) {
    const sets = (await listSets()).filter((s) => s.cardCount?.official === total);
    // Newest sets first: those are the cards people are opening right now.
    const candidates = sets.reverse().slice(0, 8);
    const hits: { brief: SetDetail["cards"][number]; score: number }[] = [];
    await Promise.all(
      candidates.map(async (s) => {
        try {
          const detail = await getSet(s.id);
          const brief = detail.cards.find((c) => sameNumber(c.localId, number));
          if (brief) hits.push({ brief, score: name ? similarity(name, brief.name) : 0.5 });
        } catch {
          /* one bad set shouldn't sink the scan */
        }
      }),
    );
    hits.sort((a, b) => b.score - a.score);
    const best = hits[0];
    if (best) {
      const unique = hits.length === 1;
      // Number + total alone is strong evidence when only one set matches.
      const confidence = name ? best.score : unique ? 0.75 : 0.4;
      if (confidence >= 0.55) return { card: await getCard(best.brief.id), confidence };
    }
  }

  if (name && name.replace(/[^a-z]/gi, "").length >= 4) {
    const results = await searchByName(name, 10);
    let best: (typeof results)[number] | undefined;
    let bestScore = 0;
    for (const r of results) {
      const s = similarity(name, r.name);
      if (s > bestScore) {
        best = r;
        bestScore = s;
      }
    }
    // Name alone can't tell printings apart, so cap confidence below the
    // auto-add threshold; the UI asks the user to confirm.
    if (best && bestScore >= 0.8) return { card: await getCard(best.id), confidence: Math.min(bestScore, 0.6) };
  }
  return null;
}
