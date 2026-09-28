// Import a collection from a spreadsheet: this app's own CSV export,
// TCGplayer, Collectr, or a hand-made list. Columns are recognised by their
// headers; each row is matched against the offline card index.
import { cardsNamed, findById, lookupNumber, setOfficialCount, setsMatching, toCardInfo, type IndexCard } from "./cardIndex";
import { similarity } from "./text";
import type { CardInfo } from "./types";

/** RFC 4180 CSV (quotes, escaped quotes, newlines in quotes). Delimiter auto-detected. */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const firstLine = text.slice(0, text.indexOf("\n") >>> 0);
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

type Field = "qty" | "name" | "set" | "number" | "id";

// Header spellings seen in the wild, normalised to lowercase letters/digits.
const HEADERS: Record<Field, string[]> = {
  qty: ["quantity", "qty", "count", "amount", "copies", "have", "owned", "totalquantity", "addtoquantity"],
  name: ["name", "cardname", "productname", "card", "title", "simplename"],
  set: ["set", "setname", "expansion", "edition", "series", "setcode", "group"],
  number: ["number", "cardnumber", "collectornumber", "no", "num", "cardno", "setnumber"],
  id: ["tcgdexid", "cardid", "id"],
};

export type Columns = Partial<Record<Field, number>>;

export function detectColumns(header: string[]): Columns {
  const keys = header.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const cols: Columns = {};
  for (const field of Object.keys(HEADERS) as Field[]) {
    for (const alias of HEADERS[field]) {
      const i = keys.indexOf(alias);
      if (i >= 0 && !Object.values(cols).includes(i)) {
        cols[field] = i;
        break;
      }
    }
  }
  return cols;
}

export type MatchHow = "id" | "set+number" | "number" | "name" | "none";

export interface ImportLine {
  line: number; // 1-based row in the file, for the preview
  qty: number;
  raw: { name?: string; set?: string; number?: string; id?: string };
  card: CardInfo | null;
  how: MatchHow;
  /** The printing is a best guess (name-only match); fine for deck building. */
  guessed: boolean;
}

export interface ImportPreview {
  columns: Columns;
  lines: ImportLine[];
  error?: string;
}

function parseNumber(s: string | undefined): { number?: string; total?: number } {
  if (!s) return {};
  const t = s.trim().replace(/^#/, "");
  const m = t.match(/^([A-Za-z]*\d+[A-Za-z]*)\s*\/\s*([A-Za-z]*\d+)$/);
  if (m) return { number: m[1], total: /^\d+$/.test(m[2]) ? Number(m[2]) : undefined };
  return t ? { number: t } : {};
}

const sameNum = (a: string, b: string) =>
  /^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) === Number(b) : a.toUpperCase() === b.toUpperCase();

// Spreadsheet names carry extras like "Dragapult ex - 130/167" or "(Full Art)".
function cleanName(name: string): string {
  return name
    .replace(/\s*[-–]\s*[A-Za-z]*\d+\s*\/\s*[A-Za-z]*\d+.*$/, "")
    .replace(/\s*[([].*?[)\]]\s*/g, " ")
    .trim();
}

function bestByName(cands: IndexCard[], name: string | undefined): IndexCard | null {
  if (!cands.length) return null;
  if (!name) return cands.length === 1 ? cands[0] : null;
  let best: IndexCard | null = null;
  let score = 0;
  for (const c of cands) {
    const s = similarity(name, c.name);
    if (s > score) {
      best = c;
      score = s;
    }
  }
  return score >= 0.6 ? best : null;
}

// With only a name to go on, assume the newest regular printing: it's the
// one most likely to be in a kid's pile and to be legal for decks.
function likeliestPrinting(printings: IndexCard[]): IndexCard {
  const score = (c: IndexCard) => {
    const mark = (c.regulationMark ?? "A").charCodeAt(0);
    const official = setOfficialCount(c.setId) ?? Infinity;
    const regular = /^\d+$/.test(c.localId) && Number(c.localId) <= official ? 1 : 0;
    return mark * 10 + regular;
  };
  return printings.reduce((best, c) => (score(c) > score(best) ? c : best));
}

export function resolveLine(raw: ImportLine["raw"]): { card: IndexCard | null; how: MatchHow; guessed: boolean } {
  if (raw.id) {
    const c = findById(raw.id.trim());
    if (c) return { card: c, how: "id", guessed: false };
  }
  const name = raw.name ? cleanName(raw.name) : undefined;
  const { number, total } = parseNumber(raw.number ?? raw.name?.match(/[A-Za-z]*\d+\s*\/\s*[A-Za-z]*\d+/)?.[0]);

  if (number && raw.set) {
    const sets = new Set(setsMatching(raw.set));
    if (sets.size) {
      const inSet = lookupNumber(number).filter((c) => sets.has(c.setId));
      const hit = inSet.length === 1 && !name ? inSet[0] : bestByName(inSet, name);
      if (hit) return { card: hit, how: "set+number", guessed: false };
    }
  }
  if (number) {
    const hit = bestByName(lookupNumber(number, total), name);
    if (hit) return { card: hit, how: "number", guessed: false };
  }
  if (name) {
    let printings = cardsNamed(name);
    if (raw.set) {
      const sets = new Set(setsMatching(raw.set));
      const inSet = printings.filter((c) => sets.has(c.setId));
      if (inSet.length === 1) return { card: inSet[0], how: "set+number", guessed: false };
      if (inSet.length) printings = inSet;
    }
    if (number) {
      const exact = printings.find((c) => sameNum(c.localId, number));
      if (exact) return { card: exact, how: "number", guessed: false };
    }
    if (printings.length) return { card: likeliestPrinting(printings), how: "name", guessed: printings.length > 1 };
  }
  return { card: null, how: "none", guessed: false };
}

export function previewCsv(text: string): ImportPreview {
  const rows = parseCsv(text);
  if (rows.length < 2) return { columns: {}, lines: [], error: "That file has no rows." };
  const columns = detectColumns(rows[0]);
  if (columns.name === undefined && columns.id === undefined && columns.number === undefined) {
    return { columns, lines: [], error: "Couldn't find a card name column. Add a header row with a column called Name." };
  }
  const cell = (r: string[], f: Field) => (columns[f] === undefined ? undefined : r[columns[f]!]?.trim() || undefined);
  const lines: ImportLine[] = [];
  rows.slice(1).forEach((r, i) => {
    const qtyText = cell(r, "qty");
    const qty = qtyText === undefined ? 1 : Math.floor(Number(qtyText.replace(/[^\d.-]/g, "")));
    if (!Number.isFinite(qty) || qty <= 0) return;
    const raw = { name: cell(r, "name"), set: cell(r, "set"), number: cell(r, "number"), id: cell(r, "id") };
    if (!raw.name && !raw.id && !raw.number) return;
    const { card, how, guessed } = resolveLine(raw);
    lines.push({ line: i + 2, qty: Math.min(qty, 999), raw, card: card ? toCardInfo(card) : null, how, guessed });
  });
  return { columns, lines };
}

/** Same card on several rows (e.g. different conditions) becomes one entry. */
export function combine(lines: ImportLine[]): { card: CardInfo; qty: number }[] {
  const byId = new Map<string, { card: CardInfo; qty: number }>();
  for (const l of lines) {
    if (!l.card) continue;
    const e = byId.get(l.card.id);
    if (e) e.qty += l.qty;
    else byId.set(l.card.id, { card: l.card, qty: l.qty });
  }
  return [...byId.values()];
}

