// Name normalization shared by the scanner, collection and deck matcher.
// Deck lists (Limitless) and the card database (TCGdex) spell things slightly
// differently: curly apostrophes, "Pokémon" accents, "Basic Fire Energy" vs
// "Fire Energy", energy symbols like "{R}".

const ENERGY_SYMBOLS: Record<string, string> = {
  G: "grass",
  R: "fire",
  W: "water",
  L: "lightning",
  P: "psychic",
  F: "fighting",
  D: "darkness",
  M: "metal",
  Y: "fairy",
  N: "dragon",
  C: "colorless",
};

export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/\{([A-Z])\}/g, (_, s: string) => ENERGY_SYMBOLS[s] ?? s)
    .toLowerCase()
    .replace(/^basic\s+(?=\w+\s+energy$)/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const BASIC_ENERGY = new Set(
  ["grass", "fire", "water", "lightning", "psychic", "fighting", "darkness", "metal", "fairy"].map(
    (t) => `${t} energy`,
  ),
);

export function isBasicEnergy(name: string): boolean {
  return BASIC_ENERGY.has(normalizeName(name));
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// 1 = identical, 0 = nothing in common. OCR output is noisy, so we also give
// credit when the OCR text contains the real name (e.g. "Pikachu ex HP 200").
export function similarity(ocr: string, real: string): number {
  const a = normalizeName(ocr).replace(/[^a-z0-9' ]/g, "");
  const b = normalizeName(real).replace(/[^a-z0-9' ]/g, "");
  if (!a || !b) return 0;
  if (a.includes(b)) return Math.max(0.9, b.length / a.length);
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}
