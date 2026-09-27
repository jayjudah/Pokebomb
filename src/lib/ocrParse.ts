// Pull a card name and collector number out of raw OCR text.

const NOISE_WORDS = new Set([
  "basic",
  "stage",
  "stage1",
  "stage2",
  "hp",
  "evolves",
  "from",
  "put",
  "on",
  "the",
  "tera",
  "item",
  "supporter",
  "stadium",
  "tool",
  "trainer",
  "pokemon",
]);

/** "130/167" style collector numbers from the bottom strip of the card. */
export function parseCollectorNumber(text: string): { number: string; total: number } | null {
  // OCR often reads "/" as "l", "|" or "I", and "0" as "O".
  const cleaned = text.replace(/[|Il\\]/g, "/").replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, "0");
  const m = cleaned.match(/(\d{1,3})\s*\/\s*(\d{2,3})(?!\d)/);
  if (!m) return null;
  const number = String(Number(m[1]));
  const total = Number(m[2]);
  if (total < 10 || Number(number) === 0) return null;
  return { number, total };
}

/** Best guess at the card name from the top strip of the card. */
export function parseName(text: string): string {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  let best = "";
  for (const line of lines) {
    const words = line
      .replace(/[^A-Za-zÀ-ſ'’. -]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0);
    const kept: string[] = [];
    for (const w of words) {
      const lw = w.toLowerCase().replace(/[^a-z]/g, "");
      if (NOISE_WORDS.has(lw)) continue;
      // Stray single letters are usually OCR junk, but "ex"/"V" suffixes matter.
      if (w.length === 1 && w !== "V") continue;
      kept.push(w);
    }
    const candidate = kept.join(" ").trim();
    if (candidate.replace(/[^A-Za-z]/g, "").length > best.replace(/[^A-Za-z]/g, "").length) {
      best = candidate;
    }
  }
  return best;
}
