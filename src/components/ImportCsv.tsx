import { useState } from "react";
import { addCard, enrichCard } from "../lib/collection";
import { loadIndex } from "../lib/cardIndex";
import { combine, previewCsv, type ImportPreview } from "../lib/csvImport";

const HOW: Record<string, string> = {
  id: "exact",
  "set+number": "set + number",
  number: "number",
  name: "name only",
};

/** Pick a CSV, preview what matched, then add it to the collection. */
export default function ImportCsv({ onClose }: { onClose(): void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  async function pick(file: File) {
    setBusy(true);
    setFileName(file.name);
    await loadIndex();
    setPreview(previewCsv(await file.text()));
    setBusy(false);
  }

  const matched = preview?.lines.filter((l) => l.card) ?? [];
  const unmatched = preview?.lines.filter((l) => !l.card) ?? [];
  const guessed = matched.filter((l) => l.guessed).length;
  const entries = combine(matched);
  const copies = entries.reduce((s, e) => s + e.qty, 0);

  function add() {
    for (const e of entries) addCard(e.card, e.qty);
    // Prices and legality trickle in afterwards, a few at a time.
    const ids = entries.map((e) => e.card.id);
    void (async () => {
      for (let i = 0; i < ids.length; i += 4) await Promise.all(ids.slice(i, i + 4).map(enrichCard));
    })();
    setDone(`Added ${copies} cards (${entries.length} different).`);
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 style={{ flex: 1, margin: 0 }}>Import CSV</h2>
          <button onClick={onClose}>{done ? "Done" : "Cancel"}</button>
        </div>

        {done ? (
          <p>{done}</p>
        ) : !preview ? (
          <>
            <p className="muted">
              Works with this app's CSV export, TCGplayer, Collectr and most spreadsheets. It needs a header row with a
              card name column; quantity, set and card number columns make matches exact.
            </p>
            <label className="filepick">
              <input
                type="file"
                accept=".csv,text/csv,text/plain,.tsv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void pick(f);
                }}
              />
              {busy ? "Reading…" : "Choose a CSV file"}
            </label>
          </>
        ) : preview.error ? (
          <>
            <p className="error">{preview.error}</p>
            <button onClick={() => setPreview(null)}>Try another file</button>
          </>
        ) : (
          <>
            <p className="muted small">{fileName}</p>
            <div className="stats">
              <div>
                <b>{copies}</b>
                <span>cards to add</span>
              </div>
              <div>
                <b>{entries.length}</b>
                <span>different</span>
              </div>
              <div>
                <b>{guessed}</b>
                <span>printing guessed</span>
              </div>
              <div>
                <b>{unmatched.length}</b>
                <span>not found</span>
              </div>
            </div>
            {guessed > 0 && (
              <p className="muted small">
                "Printing guessed" rows had only a name, so the app picked one version of the card. That's fine for
                deck building; add a set or card number column for exact printings.
              </p>
            )}
            <div className="row wrap">
              <button className="primary" disabled={!entries.length} onClick={add}>
                Add {copies} cards
              </button>
              <button onClick={() => setPreview(null)}>Choose another file</button>
            </div>

            {unmatched.length > 0 && (
              <>
                <h3>Not found ({unmatched.length})</h3>
                <ul className="cardlist">
                  {unmatched.map((l) => (
                    <li key={l.line}>
                      <span>
                        {l.qty}× {l.raw.name ?? l.raw.id ?? l.raw.number}
                      </span>
                      <span className="muted small">
                        row {l.line}
                        {l.raw.set ? ` · ${l.raw.set}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="muted small">
                  Usually older cards (before Sword &amp; Shield) or typos. You can add them with Search.
                </p>
              </>
            )}

            <h3>Matched ({matched.length} rows)</h3>
            <ul className="cardlist">
              {matched.map((l) => (
                <li key={l.line}>
                  <span>
                    {l.qty}× {l.card!.name}
                  </span>
                  <span className="muted small">
                    {l.card!.setName} #{l.card!.localId} · {HOW[l.how]}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
