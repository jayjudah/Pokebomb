// Deciding what a scan was, from image matches plus (sometimes) OCR text.
import type { IndexCard, ImageHit } from "./cardIndex";
import { normalizeName, similarity } from "./text";

// Thresholds on cosine similarity, from the synthetic photo tests: correct
// matches scored 0.73+ (10th percentile) and beat the runner-up by 0.18+,
// while an empty table scores below 0.4.
export const IMAGE_ACCEPT = 0.7;
export const IMAGE_MARGIN = 0.1;
export const IMAGE_PLAUSIBLE = 0.5;
const TIE = 0.06; // candidates this close to the leader are "the same picture"

export interface Decision {
  card: IndexCard;
  confidence: number;
  why: string;
}

export interface OcrRead {
  name?: string;
  number?: string;
  total?: number;
}

const sameNumber = (a: string, b: string) =>
  /^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) === Number(b) : a.toUpperCase() === b.toUpperCase();

/** Clear winner on the picture alone? Then we don't need to wait for OCR. */
export function decideFromImage(hits: ImageHit[], accept = IMAGE_ACCEPT, minMargin = IMAGE_MARGIN): Decision | null {
  const [a, b] = hits;
  if (!a || a.score < accept) return null;
  const margin = a.score - (b?.score ?? -1);
  if (margin >= minMargin) return { card: a.card, confidence: 0.95, why: `image ${a.score.toFixed(2)} (+${margin.toFixed(2)})` };
  return null;
}

/**
 * Close call (reprints share artwork; different printings differ only in the
 * set symbol and number): use OCR text to break the tie.
 */
export function decideWithOcr(
  hits: ImageHit[],
  ocr: OcrRead,
  setTotal: (setId: string) => number | undefined,
  accept = IMAGE_ACCEPT,
): Decision | null {
  const [a] = hits;
  if (!a || a.score < IMAGE_PLAUSIBLE) return null;
  const close = hits.filter((h) => h.score >= a.score - TIE);

  if (ocr.number) {
    const byNumber = close.filter(
      (h) => sameNumber(h.card.localId, ocr.number!) && (!ocr.total || setTotal(h.card.setId) === ocr.total),
    );
    if (byNumber.length) return { card: byNumber[0].card, confidence: 0.95, why: "image + number" };
  }

  if (ocr.name) {
    const named = close
      .map((h) => ({ h, s: similarity(ocr.name!, h.card.name) }))
      .sort((x, y) => y.s - x.s)[0];
    if (named && named.s >= 0.8) return { card: named.h.card, confidence: 0.85, why: "image + name" };
  }

  // Every look-alike is the same card name (e.g. an Ultra Ball reprint).
  // For decks the name is what matters, so take it even if the printing is a guess.
  const oneName = close.every((h) => normalizeName(h.card.name) === normalizeName(a.card.name));
  if (oneName && a.score >= accept - 0.1) return { card: a.card, confidence: 0.8, why: "image, printing guessed" };

  return { card: a.card, confidence: 0.5, why: "image unsure" };
}
