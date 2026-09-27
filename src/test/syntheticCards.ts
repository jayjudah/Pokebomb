// Procedural stand-ins for card scans: shared frame and layout (like real
// cards), different artwork and type colour. Used to test image matching
// without downloading the real database.

import { resample } from "../lib/fingerprint.ts";

export const CARD_W = 245;
export const CARD_H = 342;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const TYPE_COLORS = [
  [120, 190, 90], [230, 110, 60], [80, 150, 220], [240, 210, 70], [170, 110, 200],
  [190, 120, 80], [70, 80, 100], [160, 165, 175], [230, 150, 190], [200, 190, 160],
];

export function syntheticCard(seed: number): Uint8ClampedArray {
  const r = rng(seed);
  const px = new Uint8ClampedArray(CARD_W * CARD_H * 4);
  const type = TYPE_COLORS[Math.floor(r() * TYPE_COLORS.length)];
  const put = (x: number, y: number, c: number[]) => {
    const i = (y * CARD_W + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  };
  const artX0 = 20, artX1 = 225, artY0 = 38, artY1 = 160;
  // Up to 7 random blobs for the artwork.
  const blobs = Array.from({ length: 3 + Math.floor(r() * 5) }, () => ({
    x: artX0 + r() * (artX1 - artX0), y: artY0 + r() * (artY1 - artY0),
    rx: 10 + r() * 60, ry: 10 + r() * 50,
    c: [r() * 255, r() * 255, r() * 255],
  }));
  const sky = [r() * 255, r() * 255, r() * 255];
  const ground = [r() * 255, r() * 255, r() * 255];
  const horizon = artY0 + (0.4 + r() * 0.4) * (artY1 - artY0);
  for (let y = 0; y < CARD_H; y++) {
    for (let x = 0; x < CARD_W; x++) {
      let c: number[];
      if (x < 9 || x >= CARD_W - 9 || y < 9 || y >= CARD_H - 9) c = [235, 200, 60]; // yellow border
      else if (x >= artX0 && x < artX1 && y >= artY0 && y < artY1) {
        c = y < horizon ? sky : ground;
        for (const b of blobs) if (((x - b.x) / b.rx) ** 2 + ((y - b.y) / b.ry) ** 2 < 1) c = b.c;
      } else if (y > 14 && y < 30 && x > 18 && x < 18 + 60 + (seed % 70) && (x >> 2) % 3 !== 0) c = [20, 20, 20]; // name text
      else if (y > 180 && y < 300 && (y >> 3) % 3 === 0 && x > 20 && x < 20 + ((seed * 7 + y) % 180)) c = [40, 40, 40]; // attack text
      else c = type.map((v, i) => v * 0.55 + 255 * 0.45 - (i === 2 ? 10 : 0)); // pale type panel
      put(x, y, c);
    }
  }
  return px;
}

/** Fake phone photo: card on a table, off-centre, badly lit, noisy, with glare. */
export function photograph(card: Uint8ClampedArray, seed: number, opts: { shift?: number; scale?: number } = {}) {
  const r = rng(seed * 31 + 7);
  const W = 300, H = 419; // "guide" crop in camera pixels
  const scale = opts.scale ?? 0.93 + r() * 0.07; // card fills 93-100% of guide
  const shift = opts.shift ?? 0.03;
  const cw = W * scale, ch = H * scale;
  const ox = (W - cw) / 2 + (r() * 2 - 1) * shift * W;
  const oy = (H - ch) / 2 + (r() * 2 - 1) * shift * H;
  const gain = 0.6 + r() * 0.6, bias = -20 + r() * 50;
  const cast = [0.85 + r() * 0.3, 0.85 + r() * 0.3, 0.85 + r() * 0.3];
  const gx = r() * W, gy = r() * H, gr = 25 + r() * 40; // glare spot
  const table = [90 + r() * 60, 70 + r() * 50, 50 + r() * 40];
  const out = new Uint8ClampedArray(W * H * 4);
  const scaled = resample(card, CARD_W, CARD_H, 0, 0, CARD_W, CARD_H, Math.round(cw), Math.round(ch));
  const scw = Math.round(cw), sch = Math.round(ch);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cx = Math.round(x - ox), cy = Math.round(y - oy);
      const i = (y * W + x) * 4;
      let rgb: number[];
      if (cx >= 0 && cy >= 0 && cx < scw && cy < sch) {
        const j = (cy * scw + cx) * 4;
        rgb = [scaled[j], scaled[j + 1], scaled[j + 2]];
      } else rgb = table;
      const glare = Math.max(0, 1 - Math.hypot(x - gx, y - gy) / gr) * 140;
      for (let c = 0; c < 3; c++) out[i + c] = rgb[c] * gain * cast[c] + bias + glare + (r() - 0.5) * 30;
      out[i + 3] = 255;
    }
  }
  return { px: out, w: W, h: H };
}
