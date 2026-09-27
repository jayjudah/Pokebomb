import { useEffect, useMemo, useState } from "react";
import { useCollection } from "../lib/collection";
import { rankDecks, shoppingList, type DeckPlan } from "../lib/deckAdvisor";
import { loadMeta } from "../lib/meta";
import { useSettings } from "../lib/settings";
import type { MetaSnapshot } from "../lib/types";

const pct = (x: number) => `${Math.round(x * 100)}%`;

export default function DecksView() {
  const cards = useCollection();
  const settings = useSettings();
  const [meta, setMeta] = useState<MetaSnapshot | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    loadMeta().then(setMeta, (e) => setError((e as Error).message));
  }, []);

  const plans = useMemo(() => (meta ? rankDecks(meta.decks, cards, settings) : []), [meta, cards, settings]);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!meta) return <div className="page"><p className="muted">Loading the meta…</p></div>;

  const best = plans[0];
  return (
    <div className="page">
      <header className="page-head">
        <h1>Best decks for you</h1>
      </header>
      <p className={meta.isSample ? "banner warn" : "banner"}>
        {meta.isSample ? (
          <>Showing sample meta data. The real ranking appears once the daily meta update has run.</>
        ) : (
          <>
            {meta.format} meta from {meta.sample.tournaments} tournaments ({meta.sample.players} players),{" "}
            {meta.sample.from} to {meta.sample.to}. Source: {meta.source}.
          </>
        )}
      </p>

      {cards.length === 0 && <p className="empty">Scan some cards first and this page will rank the meta decks by how close you are.</p>}

      {best && cards.length > 0 && (
        <div className="hero">
          <div className="muted">Your best build right now</div>
          <h2>{best.deck.name}</h2>
          <p>
            You own {best.owned} of {best.total} cards ({pct(best.completion)}).{" "}
            {best.completion === 1 ? "It's ready to shuffle up." : `Missing ${best.total - best.owned}.`}
          </p>
        </div>
      )}

      <ol className="decks">
        {plans.map((p, i) => (
          <DeckRow key={p.deck.id} plan={p} rank={i + 1} open={open === p.deck.id} onToggle={() => setOpen(open === p.deck.id ? null : p.deck.id)} />
        ))}
      </ol>
      <p className="muted small">
        Build score = meta strength × (how much of the list you own)². Cards match by name, so an older printing of a
        Pokémon counts even if its attacks differ; check the set code in the list if it matters.
      </p>
    </div>
  );
}

function DeckRow({ plan, rank, open, onToggle }: { plan: DeckPlan; rank: number; open: boolean; onToggle(): void }) {
  const { deck } = plan;
  const missing = shoppingList(plan);
  return (
    <li className="deck">
      <button className="deck-head" onClick={onToggle}>
        <span className="rank">{rank}</span>
        <span className="deck-main">
          <strong>{deck.name}</strong>
          <span className="muted small">
            Meta {deck.score.toFixed(0)} · {pct(deck.share)} of field · {pct(deck.winRate)} win rate
          </span>
          <span className="bar">
            <span style={{ width: pct(plan.completion) }} />
          </span>
        </span>
        <span className="deck-own">
          <b>{pct(plan.completion)}</b>
          <span className="muted small">{plan.missingStar ? "need the star" : `${plan.total - plan.owned} missing`}</span>
        </span>
      </button>
      {open && (
        <div className="deck-body">
          {missing.length > 0 && (
            <>
              <h3>Still need</h3>
              <ul className="cardlist">
                {missing.map((l, i) => (
                  <li key={i}>
                    <span>
                      {l.need - l.have}× {l.name}
                    </span>
                    <span className="muted small">
                      {l.set ? `${l.set} ${l.number ?? ""} · ` : ""}in {pct(l.inclusion)} of lists
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3>Full list</h3>
          <ul className="cardlist">
            {plan.lines.map((l, i) => (
              <li key={i} className={l.have >= l.need ? "have" : ""}>
                <span>
                  {l.need}× {l.name}
                </span>
                <span className="small">
                  {l.have >= l.need ? "✓" : `${l.have}/${l.need}`}
                </span>
              </li>
            ))}
          </ul>
          <button className="link" onClick={() => navigator.clipboard?.writeText(toPtcgl(plan))}>
            Copy list for Pokémon TCG Live
          </button>
        </div>
      )}
    </li>
  );
}

function toPtcgl(plan: DeckPlan): string {
  const section = (cat: string, title: string) => {
    const lines = plan.lines.filter((l) => l.category === cat);
    const n = lines.reduce((s, l) => s + l.need, 0);
    return [`${title}: ${n}`, ...lines.map((l) => `${l.need} ${l.name}${l.set ? ` ${l.set} ${l.number ?? ""}` : ""}`.trim())].join("\n");
  };
  return [section("Pokemon", "Pokémon"), section("Trainer", "Trainer"), section("Energy", "Energy")].join("\n\n");
}
