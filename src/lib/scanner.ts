// Continuous scanning. The camera runs the whole time; we watch for motion
// inside the card guide, wait for the picture to settle (a new card slid in),
// identify it, then ignore the frame until something moves again. That's what
// lets you feed a stack of cards through one after another, including
// duplicates of the same card.
//
// Identification (free engine): match the picture against the offline card
// index first. A clear winner is added straight away; a close call (reprints
// share artwork) is settled by OCR reading the name and collector number.
import { createWorker, PSM, type Worker } from "tesseract.js";
import { resolveCard, type Match } from "./cardDb";
import { indexSize, loadIndex, queriesFor, searchImage, setOfficialCount, toCardInfo, type ImageHit } from "./cardIndex";
import { decideFromImage, decideWithOcr, type OcrRead } from "./matchDecision";
import { parseCollectorNumber, parseName } from "./ocrParse";
import type { ScanEngine } from "./settings";

const CARD_ASPECT = 63 / 88;
const THUMB_W = 24;
const THUMB_H = 33;
const MOTION_THRESHOLD = 10; // mean abs grey-level diff between thumbnails
const SETTLE_MS = 350;
const TICK_MS = 150;
const OCR_ATTEMPTS = 4;
const AUTO_ADD_CONFIDENCE = 0.7;
// Add ?debug to the URL to log what the OCR sees.
const DEBUG = typeof location !== "undefined" && location.search.includes("debug");
const IMAGE_MARGIN = 0.06; // extra border grabbed around the guide for shifted crops
const IMAGE_CANVAS_W = 272;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Card guide in element pixels and matching video pixels (video uses object-fit: cover). */
export function computeGuide(elW: number, elH: number, vw: number, vh: number): { el: Rect; video: Rect } {
  const scale = Math.max(elW / vw, elH / vh); // cover
  const visW = elW / scale;
  const visH = elH / scale;
  const offX = (vw - visW) / 2;
  const offY = (vh - visH) / 2;
  let h = visH * 0.78;
  let w = h * CARD_ASPECT;
  if (w > visW * 0.86) {
    w = visW * 0.86;
    h = w / CARD_ASPECT;
  }
  const video = { x: offX + (visW - w) / 2, y: offY + (visH - h) / 2, w, h };
  const el = { x: (video.x - offX) * scale, y: (video.y - offY) * scale, w: w * scale, h: h * scale };
  return { el, video };
}

export type ScanStatus = "starting" | "waiting" | "reading" | "matched" | "unsure" | "error";

export interface ScannerCallbacks {
  onStatus(status: ScanStatus, detail?: string): void;
  /** Confident read: caller adds it to the collection. */
  onMatch(match: Match): void;
  /** Plausible but not confident: caller asks the user. */
  onSuggest(match: Match): void;
}

export interface ScannerOptions {
  engine: ScanEngine;
  claudeApiKey: string;
}

export class CardScanner {
  private stream: MediaStream | null = null;
  private timer: number | undefined;
  private running = false;
  private busy = false;
  private prevThumb: Float32Array | null = null;
  private emptyThumb: Float32Array | null = null;
  private stillSince: number | null = null;
  private handled = false; // already read this settled frame
  private attempts = 0;
  private lastRead: string | null = null;
  private sawText = false; // OCR found something readable this settle
  private nameWorker: Worker | null = null;
  private numberWorker: Worker | null = null;
  private ocrLoading: Promise<void> | null = null;
  private thumbCanvas = document.createElement("canvas");
  private workCanvas = document.createElement("canvas");

  constructor(
    private video: HTMLVideoElement,
    private cb: ScannerCallbacks,
    public options: ScannerOptions,
  ) {
    this.thumbCanvas.width = THUMB_W;
    this.thumbCanvas.height = THUMB_H;
  }

  async start() {
    this.running = true;
    this.cb.onStatus("starting");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch (err) {
      this.cb.onStatus("error", `Camera unavailable: ${(err as Error).message}`);
      return;
    }
    if (!this.running) {
      // stop() ran while we waited for camera permission.
      this.stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.video.srcObject = this.stream;
    this.video.setAttribute("playsinline", "true");
    await this.video.play().catch(() => {});
    if (this.options.engine === "free") {
      this.cb.onStatus("starting", "Loading card database…");
      await loadIndex();
      // The text reader is only a tie-breaker now; warm it up in the background.
      void this.ensureOcr().catch(() => {});
    }
    if (!this.running) return;
    this.cb.onStatus("waiting");
    this.loop();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.nameWorker?.terminate();
    void this.numberWorker?.terminate();
    this.nameWorker = this.numberWorker = null;
    this.ocrLoading = null;
  }

  /** Scan the same card again (e.g. a second copy that didn't trigger motion). */
  rescan() {
    this.handled = false;
    this.attempts = 0;
    this.lastRead = null;
    this.emptyThumb = null;
  }

  async setTorch(on: boolean): Promise<boolean> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      return true;
    } catch {
      return false;
    }
  }

  private ensureOcr(): Promise<void> {
    this.ocrLoading ??= this.loadOcr().catch((err) => {
      this.ocrLoading = null;
      throw err;
    });
    return this.ocrLoading;
  }

  private async loadOcr() {
    const [nameW, numW] = await Promise.all([createWorker("eng"), createWorker("eng")]);
    await nameW.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    await numW.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      tessedit_char_whitelist: "0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    });
    if (!this.running) {
      void nameW.terminate();
      void numW.terminate();
      return;
    }
    this.nameWorker = nameW;
    this.numberWorker = numW;
  }

  private guide(): Rect | null {
    const v = this.video;
    if (!v.videoWidth || v.readyState < 2) return null;
    return computeGuide(v.clientWidth, v.clientHeight, v.videoWidth, v.videoHeight).video;
  }

  private loop = () => {
    if (!this.running) return;
    this.tick().finally(() => {
      if (this.running) this.timer = window.setTimeout(this.loop, TICK_MS);
    });
  };

  private thumbnail(g: Rect): Float32Array {
    const ctx = this.thumbCanvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(this.video, g.x, g.y, g.w, g.h, 0, 0, THUMB_W, THUMB_H);
    const px = ctx.getImageData(0, 0, THUMB_W, THUMB_H).data;
    const out = new Float32Array(THUMB_W * THUMB_H);
    for (let i = 0; i < out.length; i++) out[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    return out;
  }

  private static diff(a: Float32Array, b: Float32Array): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  }

  private async tick() {
    if (this.busy) return;
    const g = this.guide();
    if (!g) return;
    const thumb = this.thumbnail(g);
    const now = performance.now();
    const moved = this.prevThumb ? CardScanner.diff(thumb, this.prevThumb) > MOTION_THRESHOLD : true;
    this.prevThumb = thumb;

    if (moved) {
      this.stillSince = null;
      if (this.handled || this.attempts) {
        this.handled = false;
        this.attempts = 0;
        this.lastRead = null;
        this.sawText = false;
        this.cb.onStatus("waiting");
      }
      return;
    }
    this.stillSince ??= now;
    if (this.handled || now - this.stillSince < SETTLE_MS) return;
    // Same picture as the last time we found nothing: the card was removed.
    if (this.emptyThumb && CardScanner.diff(thumb, this.emptyThumb) < MOTION_THRESHOLD) {
      this.handled = true;
      return;
    }

    this.busy = true;
    this.cb.onStatus("reading");
    try {
      const match = this.options.engine === "claude" ? await this.readClaude(g) : await this.readFree(g);
      this.attempts++;
      if (match && match.confidence >= AUTO_ADD_CONFIDENCE) {
        // Shakier reads have to agree with themselves twice.
        const agreed = this.options.engine === "claude" || match.confidence >= 0.8 || this.lastRead === match.card.id;
        this.lastRead = match.card.id;
        if (agreed) {
          this.handled = true;
          this.emptyThumb = null;
          this.cb.onMatch(match);
          this.cb.onStatus("matched", match.card.name);
          return;
        }
      } else if (match) {
        this.handled = true;
        this.cb.onSuggest(match);
        this.cb.onStatus("unsure", match.card.name);
        return;
      }
      const maxAttempts = this.options.engine === "claude" ? 1 : OCR_ATTEMPTS;
      if (DEBUG) console.log("[scan] no match, attempt", this.attempts);
      if (this.attempts >= maxAttempts) {
        this.handled = true;
        this.emptyThumb = thumb;
        // An empty table reads as nothing at all; only complain about real cards.
        this.cb.onStatus("waiting", this.sawText ? "Couldn't read that one. Try tilting it out of the glare." : undefined);
      }
    } catch (err) {
      this.handled = true;
      this.cb.onStatus("error", (err as Error).message);
    } finally {
      this.busy = false;
    }
  }

  /** Crop part of the card (fractions of the guide) into the work canvas, upscaled and greyscale. */
  private crop(g: Rect, fx: number, fy: number, fw: number, fh: number, outW: number): HTMLCanvasElement {
    const c = this.workCanvas;
    const sw = g.w * fw;
    const sh = g.h * fh;
    c.width = outW;
    c.height = Math.round((outW * sh) / sw);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(this.video, g.x + g.w * fx, g.y + g.h * fy, sw, sh, 0, 0, c.width, c.height);
    // Greyscale + contrast stretch by hand (Safari ignores ctx.filter).
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    let lo = 255;
    let hi = 0;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = y;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    const k = hi > lo ? 255 / (hi - lo) : 1;
    for (let i = 0; i < d.length; i += 4) {
      const y = (d[i] - lo) * k;
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** Fingerprint the card in the guide (several crops) and search the index. */
  private imageSearch(g: Rect): ImageHit[] {
    const m = IMAGE_MARGIN;
    const region = { x: g.x - m * g.w, y: g.y - m * g.h, w: g.w * (1 + 2 * m), h: g.h * (1 + 2 * m) };
    const c = this.workCanvas;
    c.width = IMAGE_CANVAS_W;
    c.height = Math.round((IMAGE_CANVAS_W * region.h) / region.w);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(this.video, region.x, region.y, region.w, region.h, 0, 0, c.width, c.height);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    const k = c.width / region.w;
    const guide = { x: m * g.w * k, y: m * g.h * k, w: g.w * k, h: g.h * k };
    return searchImage(queriesFor(px, c.width, c.height, guide));
  }

  private async readFree(g: Rect): Promise<Match | null> {
    let hits: ImageHit[] = [];
    if (indexSize()) {
      hits = this.imageSearch(g);
      if (DEBUG) console.log("[scan:image]", hits.slice(0, 3).map((h) => `${h.card.id} ${h.card.name} ${h.score.toFixed(3)}`).join(" | "));
      const quick = decideFromImage(hits);
      if (quick) {
        this.sawText = true;
        return { card: toCardInfo(quick.card), confidence: quick.confidence };
      }
    }
    const ocr = await this.ocrRead(g);
    if (ocr.name || ocr.number) this.sawText = true;
    const byImage = decideWithOcr(hits, ocr, setOfficialCount);
    if (DEBUG && byImage) console.log("[scan:decide]", byImage.why, byImage.card.id);
    if (byImage && byImage.confidence >= AUTO_ADD_CONFIDENCE) {
      this.sawText = true;
      return { card: toCardInfo(byImage.card), confidence: byImage.confidence };
    }
    // Picture didn't settle it (or the card is newer than the index): go by the text.
    const byText = ocr.name || ocr.number ? await resolveCard(ocr) : null;
    if (byImage && (!byText || byText.confidence < byImage.confidence)) {
      return { card: toCardInfo(byImage.card), confidence: byImage.confidence };
    }
    return byText;
  }

  private async ocrRead(g: Rect): Promise<OcrRead> {
    await this.ensureOcr();
    if (!this.nameWorker || !this.numberWorker) return {};
    // Name band across the top; collector number in the bottom-left corner.
    const nameText = (await this.nameWorker.recognize(this.crop(g, 0.03, 0.02, 0.74, 0.14, 1000))).data.text;
    const numText = (await this.numberWorker.recognize(this.crop(g, 0.0, 0.875, 0.55, 0.11, 1100))).data.text;
    const name = parseName(nameText);
    const num = parseCollectorNumber(numText);
    if (DEBUG) console.log("[scan:ocr]", JSON.stringify({ nameText, numText, name, num }));
    return { name: name || undefined, number: num?.number, total: num?.total };
  }

  private async readClaude(g: Rect): Promise<Match | null> {
    if (!this.options.claudeApiKey) throw new Error("Add a Claude API key in Settings to use AI scan.");
    const c = this.workCanvas;
    const scale = Math.min(1, 1000 / g.h);
    c.width = Math.round(g.w * scale);
    c.height = Math.round(g.h * scale);
    c.getContext("2d")!.drawImage(this.video, g.x, g.y, g.w, g.h, 0, 0, c.width, c.height);
    const b64 = c.toDataURL("image/jpeg", 0.85).split(",")[1];
    // Loaded on demand so on-device scanning doesn't download the SDK.
    const { readCardWithClaude } = await import("./claudeVision");
    const read = await readCardWithClaude(this.options.claudeApiKey, b64);
    if (!read) return null;
    this.sawText = true;
    const match = await resolveCard({
      name: read.name,
      number: read.collector_number ? String(Number(read.collector_number) || read.collector_number) : undefined,
      total: read.set_total || undefined,
    });
    // Claude reads text reliably; trust it when name and number both line up.
    if (match && Number(match.card.localId) === Number(read.collector_number) && match.confidence >= 0.8) {
      match.confidence = Math.max(match.confidence, 0.9);
    }
    return match;
  }
}
