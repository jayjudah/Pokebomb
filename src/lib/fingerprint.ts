// Image fingerprints for matching a camera frame against every card image in
// the database. Shared by the browser scanner and scripts/build-card-index.mjs,
// so keep this file free of imports and DOM APIs.
//
// A fingerprint is a tiny colour thumbnail of the whole card plus a sharper
// one of the artwork, each normalised per colour channel (zero mean, unit
// variance). The normalisation cancels out room lighting and white balance,
// so a photo under a yellow lamp still lands near the clean scan.

export const SRC_W = 128;
export const SRC_H = 176;

interface Block {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  cw: number;
  ch: number;
}

// Whole card: 8x11 cells of 16px.
const FULL: Block = { x0: 0, y0: 0, cols: 8, rows: 11, cw: 16, ch: 16 };
// Artwork window (upper-middle of the card; art on full-art cards too): 10x6 cells of 11px.
const ART: Block = { x0: 9, y0: 18, cols: 10, rows: 6, cw: 11, ch: 11 };
const BLOCKS = [FULL, ART];

export const DIMS = BLOCKS.reduce((s, b) => s + b.cols * b.rows * 3, 0); // 444
const QUANT = 40; // int8 steps per standard deviation

export function fingerprint(rgba: ArrayLike<number>, width = SRC_W, height = SRC_H): Int8Array {
  if (width !== SRC_W || height !== SRC_H) throw new Error(`fingerprint expects ${SRC_W}x${SRC_H} pixels`);
  const out = new Int8Array(DIMS);
  let o = 0;
  for (const b of BLOCKS) {
    const n = b.cols * b.rows;
    const cells = new Float32Array(n * 3);
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        let R = 0;
        let G = 0;
        let B = 0;
        for (let y = 0; y < b.ch; y++) {
          let p = ((b.y0 + r * b.ch + y) * width + b.x0 + c * b.cw) * 4;
          for (let x = 0; x < b.cw; x++, p += 4) {
            R += rgba[p];
            G += rgba[p + 1];
            B += rgba[p + 2];
          }
        }
        const i = (r * b.cols + c) * 3;
        cells[i] = R;
        cells[i + 1] = G;
        cells[i + 2] = B;
      }
    }
    for (let ch = 0; ch < 3; ch++) {
      let mean = 0;
      for (let i = ch; i < cells.length; i += 3) mean += cells[i];
      mean /= n;
      let v = 0;
      for (let i = ch; i < cells.length; i += 3) v += (cells[i] - mean) ** 2;
      const sd = Math.sqrt(v / n) || 1;
      for (let i = ch; i < cells.length; i += 3) {
        out[o + i] = Math.max(-127, Math.min(127, Math.round(((cells[i] - mean) / sd) * QUANT)));
      }
    }
    o += cells.length;
  }
  return out;
}

export function norm(v: Int8Array, offset = 0): number {
  let s = 0;
  for (let i = 0; i < DIMS; i++) s += v[offset + i] * v[offset + i];
  return Math.sqrt(s) || 1;
}

/** Cosine similarity between a query and row `row` of a packed index. */
export function cosineAt(q: Int8Array, qNorm: number, index: Int8Array, row: number, rowNorm: number): number {
  const off = row * DIMS;
  let s = 0;
  for (let i = 0; i < DIMS; i++) s += q[i] * index[off + i];
  return s / (qNorm * rowNorm);
}

/** Bilinear resample of an RGBA region into a dw x dh image. */
export function resample(
  src: ArrayLike<number>, sw: number, sh: number,
  rx: number, ry: number, rw: number, rh: number, dw: number, dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1.001, Math.max(0, rx + ((x + 0.5) * rw) / dw - 0.5));
      const fy = Math.min(sh - 1.001, Math.max(0, ry + ((y + 0.5) * rh) / dh - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      for (let c = 0; c < 4; c++) {
        const p = (yy: number, xx: number) => src[(yy * sw + xx) * 4 + c];
        out[(y * dw + x) * 4 + c] =
          p(y0, x0) * (1 - ax) * (1 - ay) + p(y0, x0 + 1) * ax * (1 - ay) + p(y0 + 1, x0) * (1 - ax) * ay + p(y0 + 1, x0 + 1) * ax * ay;
      }
    }
  }
  return out;
}
