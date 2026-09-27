import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { cosineAt, DIMS, fingerprint, norm, resample, SRC_H, SRC_W } from "./fingerprint";
import { CARD_H, CARD_W, photograph, syntheticCard } from "../test/syntheticCards";

const N = 400;

async function indexFingerprint(px: Uint8ClampedArray) {
  // Same path as scripts/build-card-index.mjs.
  const raw = await sharp(Buffer.from(px.buffer), { raw: { width: CARD_W, height: CARD_H, channels: 4 } })
    .resize(SRC_W, SRC_H, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();
  return fingerprint(raw);
}

function best(q: Int8Array, index: Int8Array, norms: Float32Array) {
  const qn = norm(q);
  let top = -1, topScore = -2, second = -2;
  for (let r = 0; r < norms.length; r++) {
    const s = cosineAt(q, qn, index, r, norms[r]);
    if (s > topScore) { second = topScore; topScore = s; top = r; } else if (s > second) second = s;
  }
  return { top, topScore, second };
}

describe("image fingerprint matching", () => {
  it("finds the right card from a bad phone photo among 400 look-alikes", async () => {
    const cards = Array.from({ length: N }, (_, i) => syntheticCard(i + 1));
    const index = new Int8Array(N * DIMS);
    const norms = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      index.set(await indexFingerprint(cards[i]), i * DIMS);
      norms[i] = norm(index, i * DIMS);
    }
    let correct = 0;
    const scores: number[] = [];
    const margins: number[] = [];
    const trials = 150;
    for (let t = 0; t < trials; t++) {
      const i = (t * 37) % N;
      const photo = photograph(cards[i], t);
      const q = fingerprint(resample(photo.px, photo.w, photo.h, 0, 0, photo.w, photo.h, SRC_W, SRC_H));
      const { top, topScore, second } = best(q, index, norms);
      if (top === i) {
        correct++;
        scores.push(topScore);
        margins.push(topScore - second);
      }
    }
    const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
    console.log(
      `top-1 ${correct}/${trials}; correct score p10=${pct(scores, 0.1).toFixed(3)} median=${pct(scores, 0.5).toFixed(3)}; margin p10=${pct(margins, 0.1).toFixed(3)}`,
    );
    expect(correct / trials).toBeGreaterThan(0.95);
  }, 60_000);

  it("scores an empty table low", async () => {
    const card = syntheticCard(5);
    const q0 = await indexFingerprint(card);
    const table = new Uint8ClampedArray(SRC_W * SRC_H * 4).map((_, i) => (i % 4 === 3 ? 255 : 110 + ((i * 7919) % 23)));
    const q = fingerprint(table);
    expect(cosineAt(q, norm(q), q0, 0, norm(q0))).toBeLessThan(0.4);
  });
});
