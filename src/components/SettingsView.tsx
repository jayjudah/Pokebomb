import { useEffect, useRef, useState } from "react";
import { exportCsv, exportJson, parseImport, replaceCollection, useCollection } from "../lib/collection";
import { updateSettings, useSettings } from "../lib/settings";
import { indexSize, loadIndex } from "../lib/cardIndex";
import Account from "./Account";
import ImportCsv from "./ImportCsv";

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SettingsView() {
  const s = useSettings();
  const cards = useCollection();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  const [importing, setImporting] = useState(false);
  const [indexed, setIndexed] = useState(indexSize());
  useEffect(() => {
    void loadIndex().then(() => setIndexed(indexSize()));
  }, []);
  const date = new Date().toISOString().slice(0, 10);

  return (
    <div className="page settings">
      <header className="page-head">
        <h1>Settings</h1>
      </header>

      <section>
        <h2>Account &amp; sync</h2>
        <Account />
      </section>

      <section>
        <h2>Scanning</h2>
        <label className="radio">
          <input type="radio" checked={s.engine === "free"} onChange={() => updateSettings({ engine: "free" })} />
          <span>
            <b>Free</b> (recommended). Matches the card's picture against{" "}
            {indexed ? `${indexed.toLocaleString()} cards stored on this device` : "the offline card database"}, and reads
            the name and number to tell reprints apart. Works offline.
          </span>
        </label>
        <label className="radio">
          <input type="radio" checked={s.engine === "claude"} onChange={() => updateSettings({ engine: "claude" })} />
          <span>
            <b>AI scan</b> (optional, paid). Sends a photo of each card to Claude. Only worth it if free scanning
            struggles with your cards. Needs an Anthropic API key and costs a fraction of a cent per card.
          </span>
        </label>
        <label className="field">
          Anthropic API key
          <input
            type="password"
            autoComplete="off"
            placeholder="sk-ant-…"
            value={s.claudeApiKey}
            onChange={(e) => updateSettings({ claudeApiKey: e.target.value.trim() })}
          />
          <span className="muted small">Stored only on this device. Anyone using this phone can use it.</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.sound} onChange={(e) => updateSettings({ sound: e.target.checked })} />
          Beep and buzz when a card is added
        </label>
      </section>

      <section>
        <h2>Deck advice</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={s.standardOnly}
            onChange={(e) => updateSettings({ standardOnly: e.target.checked })}
          />
          Only count Standard-legal cards
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={s.assumeBasicEnergy}
            onChange={(e) => updateSettings({ assumeBasicEnergy: e.target.checked })}
          />
          Assume we have enough basic energy
        </label>
        <label className="field">
          Legal regulation marks (used when the card database has no legality info)
          <input
            value={s.legalMarks.join(", ")}
            onChange={(e) =>
              updateSettings({
                legalMarks: e.target.value
                  .split(/[\s,]+/)
                  .map((m) => m.trim().toUpperCase())
                  .filter(Boolean),
              })
            }
          />
        </label>
      </section>

      <section>
        <h2>Collection ({cards.length} unique cards)</h2>
        <div className="row wrap">
          <button onClick={() => download(`pokebomb-${date}.json`, exportJson(), "application/json")}>Export backup</button>
          <button onClick={() => download(`pokebomb-${date}.csv`, exportCsv(), "text/csv")}>Export CSV</button>
          <button onClick={() => setImporting(true)}>Import CSV</button>
          <button onClick={() => fileRef.current?.click()}>Restore backup</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const next = parseImport(await f.text());
                if (confirm(`Replace your collection with ${next.length} cards from this file?`)) {
                  replaceCollection(next);
                  setMsg(`Imported ${next.length} cards.`);
                }
              } catch (err) {
                setMsg(`Import failed: ${(err as Error).message}`);
              }
              e.target.value = "";
            }}
          />
          <button
            className="danger"
            onClick={() => {
              if (confirm("Delete every card in the collection? Export a backup first if you might want it back.")) {
                replaceCollection([]);
              }
            }}
          >
            Clear collection
          </button>
        </div>
        {msg && <p className="muted">{msg}</p>}
      </section>

      <p className="muted small">
        Card data and images: TCGdex. Meta: Limitless TCG. Not affiliated with Nintendo, The Pokémon Company or Game
        Freak.
      </p>
      {importing && <ImportCsv onClose={() => setImporting(false)} />}
    </div>
  );
}
