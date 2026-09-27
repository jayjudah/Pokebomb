import { useMemo, useState } from "react";
import { addCard, adjustQty, useCollection } from "../lib/collection";
import { imageUrl } from "../lib/cardDb";
import { isLegal } from "../lib/deckAdvisor";
import { useSettings } from "../lib/settings";
import type { OwnedCard } from "../lib/types";
import CardSearch from "./CardSearch";
import ImportCsv from "./ImportCsv";
import { SyncChip } from "./Account";

type Filter = "all" | "Pokemon" | "Trainer" | "Energy";
type Sort = "recent" | "name" | "set" | "value";

export default function CollectionView() {
  const cards = useCollection();
  const settings = useSettings();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [legalOnly, setLegalOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("recent");
  const [open, setOpen] = useState<OwnedCard | null>(null);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);

  const stats = useMemo(() => {
    const total = cards.reduce((s, c) => s + c.qty, 0);
    const value = cards.reduce((s, c) => s + (c.price ?? 0) * c.qty, 0);
    const legal = cards.filter((c) => isLegal(c, { ...settings, standardOnly: true })).reduce((s, c) => s + c.qty, 0);
    return { unique: cards.length, total, value, legal };
  }, [cards, settings]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = cards.filter(
      (c) =>
        (filter === "all" || c.category === filter) &&
        (!legalOnly || isLegal(c, { ...settings, standardOnly: true })) &&
        (!needle || c.name.toLowerCase().includes(needle) || c.setName.toLowerCase().includes(needle)),
    );
    const bySort: Record<Sort, (a: OwnedCard, b: OwnedCard) => number> = {
      recent: (a, b) => b.addedAt - a.addedAt,
      name: (a, b) => a.name.localeCompare(b.name),
      set: (a, b) => a.setId.localeCompare(b.setId) || Number(a.localId) - Number(b.localId),
      value: (a, b) => (b.price ?? 0) - (a.price ?? 0),
    };
    return [...list].sort(bySort[sort]);
  }, [cards, q, filter, legalOnly, sort, settings]);

  // Set completion, like a binder checklist.
  const sets = useMemo(() => {
    const m = new Map<string, { name: string; have: number; of?: number }>();
    for (const c of cards) {
      const s = m.get(c.setId) ?? { name: c.setName, have: 0, of: c.setOfficialCount };
      if (Number(c.localId) <= (c.setOfficialCount ?? Infinity)) s.have++;
      m.set(c.setId, s);
    }
    return [...m.entries()].sort((a, b) => b[1].have - a[1].have);
  }, [cards]);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Collection</h1>
        <div className="head-actions">
          <SyncChip />
          <button onClick={() => setImporting(true)}>Import CSV</button>
          <button className="primary" onClick={() => setSearching(true)}>
            + Add
          </button>
        </div>
      </header>

      <div className="stats">
        <div>
          <b>{stats.total}</b>
          <span>cards</span>
        </div>
        <div>
          <b>{stats.unique}</b>
          <span>unique</span>
        </div>
        <div>
          <b>{stats.legal}</b>
          <span>Standard legal</span>
        </div>
        <div>
          <b>${stats.value.toFixed(0)}</b>
          <span>est. value</span>
        </div>
      </div>

      {sets.length > 0 && (
        <details className="sets">
          <summary>Set progress ({sets.length} sets)</summary>
          {sets.map(([id, s]) => (
            <div key={id} className="set-row">
              <span>{s.name}</span>
              <span className="muted">
                {s.have}
                {s.of ? ` / ${s.of}` : ""}
              </span>
              {s.of ? (
                <div className="bar">
                  <div style={{ width: `${Math.min(100, (100 * s.have) / s.of)}%` }} />
                </div>
              ) : null}
            </div>
          ))}
        </details>
      )}

      <div className="filters">
        <div className="row">
          <input placeholder="Search your cards" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="recent">Newest</option>
            <option value="name">Name</option>
            <option value="set">Set</option>
            <option value="value">Value</option>
          </select>
        </div>
        <div className="chips">
          {(["all", "Pokemon", "Trainer", "Energy"] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? "chip on" : "chip"} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "Pokemon" ? "Pokémon" : f}
            </button>
          ))}
          <button className={legalOnly ? "chip on" : "chip"} onClick={() => setLegalOnly(!legalOnly)}>
            Standard
          </button>
        </div>
      </div>

      {cards.length === 0 ? (
        <p className="empty">No cards yet. Head to Scan and start sliding cards under the camera.</p>
      ) : (
        <div className="grid">
          {shown.map((c) => (
            <button key={c.id} className="grid-card" onClick={() => setOpen(c)}>
              {imageUrl(c) ? <img loading="lazy" src={imageUrl(c)} alt={c.name} /> : <div className="noimg">{c.name}</div>}
              {c.qty > 1 && <span className="qty">×{c.qty}</span>}
            </button>
          ))}
        </div>
      )}

      {open && <CardDetail card={cards.find((c) => c.id === open.id) ?? open} onClose={() => setOpen(null)} />}
      {importing && <ImportCsv onClose={() => setImporting(false)} />}
      {searching && (
        <CardSearch
          onClose={() => setSearching(false)}
          onPick={(card) => {
            addCard(card);
            setSearching(false);
          }}
        />
      )}
    </div>
  );
}

function CardDetail({ card, onClose }: { card: OwnedCard; onClose(): void }) {
  const settings = useSettings();
  const legal = isLegal(card, { ...settings, standardOnly: true });
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet detail" onClick={(e) => e.stopPropagation()}>
        {imageUrl(card, "high") && <img src={imageUrl(card, "high")} alt={card.name} />}
        <h2>{card.name}</h2>
        <p className="muted">
          {card.setName} · #{card.localId}
          {card.rarity ? ` · ${card.rarity}` : ""}
        </p>
        <p>
          <span className={legal ? "tag ok" : "tag"}>{legal ? "Standard legal" : "Not in Standard"}</span>
          {card.regulationMark && <span className="tag">Mark {card.regulationMark}</span>}
          {card.price != null && <span className="tag">${card.price.toFixed(2)}</span>}
        </p>
        <div className="stepper">
          <button onClick={() => adjustQty(card.id, -1)}>−</button>
          <b>{card.qty}</b>
          <button onClick={() => adjustQty(card.id, 1)}>+</button>
        </div>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
