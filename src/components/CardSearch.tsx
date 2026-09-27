import { useEffect, useState } from "react";
import { getCard, searchByName } from "../lib/cardDb";
import type { CardInfo } from "../lib/types";

interface Brief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

export default function CardSearch({ onPick, onClose }: { onPick(card: CardInfo): void; onClose(): void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Brief[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (q.trim().length < 3) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        // Newest printings first; they're the ones that matter for Standard.
        setResults((await searchByName(q, 60)).reverse());
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <input autoFocus placeholder="Card name, e.g. Dragapult ex" value={q} onChange={(e) => setQ(e.target.value)} />
          <button onClick={onClose}>Done</button>
        </div>
        {loading && <p className="muted">Searching…</p>}
        {error && <p className="error">{error}</p>}
        <div className="grid">
          {results.map((r) => (
            <button
              key={r.id}
              className="grid-card"
              onClick={async () => {
                try {
                  onPick(await getCard(r.id));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {r.image ? <img loading="lazy" src={`${r.image}/low.webp`} alt={r.name} /> : <div className="noimg">{r.name}</div>}
              <span className="grid-label">
                {r.name} · {r.id.split("-")[0]} #{r.localId}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
