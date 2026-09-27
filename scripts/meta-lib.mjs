// Turns Limitless tournament standings into a ranked list of archetypes with
// a representative decklist each. Pure functions so they're easy to test.

const CATEGORY = { pokemon: "Pokemon", trainer: "Trainer", energy: "Energy" };

function cardKey(category, card) {
  // Pokémon printings differ (different attacks), so key them by set+number.
  return category === "Pokemon" ? `${category}|${card.name}|${card.set}|${card.number}` : `${category}|${card.name}`;
}

function flatten(decklist) {
  const out = [];
  for (const [section, category] of Object.entries(CATEGORY)) {
    for (const c of decklist?.[section] ?? []) {
      out.push({ ...c, category, key: cardKey(category, c) });
    }
  }
  return out;
}

function listSize(cards) {
  return cards.reduce((s, c) => s + (c.count ?? 0), 0);
}

/**
 * @param {Array<{tournament: {id: string, name: string, date: string, players: number}, standings: any[]}>} events
 */
export function aggregate(events, { minPlayers = 5, maxDecks = 30 } = {}) {
  const archetypes = new Map();
  let totalPlayers = 0;

  for (const { tournament, standings } of events) {
    const cutoff = Math.min(8, Math.max(1, Math.floor((tournament.players ?? standings.length) / 8)));
    for (const s of standings) {
      const deck = s.deck;
      if (!deck?.id || deck.id === "other") continue;
      totalPlayers++;
      let a = archetypes.get(deck.id);
      if (!a) {
        a = { id: deck.id, name: deck.name ?? deck.id, icons: deck.icons, players: 0, w: 0, l: 0, t: 0, top: 0, lists: [], best: null };
        archetypes.set(deck.id, a);
      }
      a.players++;
      a.w += s.record?.wins ?? 0;
      a.l += s.record?.losses ?? 0;
      a.t += s.record?.ties ?? 0;
      if (s.placing && s.placing <= Math.max(cutoff, 8)) a.top++;

      const cards = flatten(s.decklist);
      if (listSize(cards) !== 60) continue;
      a.lists.push(cards);
      // Representative list: best finish; ties go to the more recent event.
      const rank = { placing: s.placing ?? 9999, date: tournament.date ?? "" };
      if (!a.best || rank.placing < a.best.placing || (rank.placing === a.best.placing && rank.date > a.best.date)) {
        a.best = { ...rank, cards };
      }
    }
  }

  const rows = [...archetypes.values()].filter((a) => a.players >= minPlayers && a.best);
  if (!rows.length) return [];

  for (const a of rows) {
    const games = a.w + a.l + a.t;
    a.share = a.players / totalPlayers;
    a.winRate = games ? (a.w + a.t / 2) / games : 0;
    a.topCutRate = a.top / a.players;
  }

  // Score: popularity, win rate and conversion to top 8, each min-max scaled.
  // Win rate is shrunk toward 50% for small samples so one lucky player
  // doesn't crown a rogue deck.
  const adj = (a) => (a.winRate * a.players + 0.5 * 20) / (a.players + 20);
  const scale = (vals) => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return (v) => (hi === lo ? 1 : (v - lo) / (hi - lo));
  };
  const sShare = scale(rows.map((a) => Math.sqrt(a.share)));
  const sWin = scale(rows.map(adj));
  const sTop = scale(rows.map((a) => a.topCutRate));

  const decks = rows.map((a) => {
    const inclusion = new Map();
    for (const list of a.lists) {
      const seen = new Set(list.map((c) => (c.category === "Pokemon" ? `Pokemon|${c.name}` : c.key)));
      for (const k of seen) inclusion.set(k, (inclusion.get(k) ?? 0) + 1);
    }
    const n = a.lists.length || 1;
    const list = a.best.cards.map((c) => ({
      count: c.count,
      name: c.name,
      category: c.category,
      ...(c.set ? { set: c.set } : {}),
      ...(c.number ? { number: String(c.number) } : {}),
      inclusion: round((inclusion.get(c.category === "Pokemon" ? `Pokemon|${c.name}` : c.key) ?? 0) / n, 2),
    }));
    const score = 100 * (0.4 * sShare(Math.sqrt(a.share)) + 0.4 * sWin(adj(a)) + 0.2 * sTop(a.topCutRate));
    return {
      id: a.id,
      name: a.name,
      ...(a.icons ? { icons: a.icons } : {}),
      players: a.players,
      share: round(a.share, 4),
      winRate: round(a.winRate, 4),
      topCutRate: round(a.topCutRate, 4),
      score: round(score, 1),
      list,
    };
  });

  return decks.sort((x, y) => y.score - x.score).slice(0, maxDecks);
}

function round(x, d) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
