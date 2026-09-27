# Pokebomb

Scan a Pokémon card collection with your phone camera, then find out which competitive deck you can build from it.

- **Continuous scanning.** Point the phone at a spot on the table and slide cards under it one after another. The app waits for each new card to settle, reads it, beeps, and adds it. No tapping between cards. Duplicates count.
- **Collection tracker.** Card images, quantities, set progress, Standard legality, rough market value, search and filters. Export/import backups (JSON) or CSV.
- **Meta deck advisor.** Pulls recent tournament results from [Limitless TCG](https://play.limitlesstcg.com), ranks the archetypes, and scores each one against your collection: how strong the deck is × how much of it you already own. Tap a deck to see exactly which cards you're missing, most important first, and copy the list into Pokémon TCG Live.

It's a web app (PWA). Open it on a phone, "Add to Home Screen", and it behaves like a native app, including offline use after the first load.

## How scanning works (free, offline)

The app ships with its own card database: every card from the Scarlet & Violet, Mega Evolution and Sword & Shield eras (about 10k cards), each with a tiny image fingerprint. Scanning a card:

1. **Match the picture.** The camera frame is fingerprinted (15 slightly shifted crops, so sloppy placement is fine) and compared against every card on the device. Lighting and colour casts are normalised away. A clear winner is added immediately.
2. **Break ties with text.** Reprints share artwork (Ultra Ball, Iono…), so when the top matches are too close, on-device OCR reads the collector number (`130/167`) and name to pick the exact printing. If it still can't tell, it keeps the name (all deck-building cares about) and guesses the printing.
3. **Fill in details.** Price and legality come from [TCGdex](https://tcgdex.dev) in the background when online.

No accounts, no API keys, no per-scan cost. If the app isn't sure, it asks ("Is this it?") instead of adding the wrong card.

In testing on synthetic cards with harsh lighting, glare, noise and off-centre placement, the picture match picked the right card out of 400 look-alikes 100% of the time. Real cards (holo foil, sleeves, top-loaders) will be harder; add `?debug` to the URL to see match scores in the browser console if something misreads.

The index is built by `npm run index` (runs in CI; incremental, so after the first run it only downloads newly released cards). Pick eras with `SERIES=sv,me,swsh`.

**Optional:** Settings has a paid "AI scan" mode that sends each photo to Claude. It isn't needed; it's there if some unusual cards won't scan.

Tips: even light, fill the frame, avoid glare. A cheap phone stand makes the "slide cards through" flow much nicer.

## How deck ranking works

`scripts/fetch-meta.mjs` grabs the last 30 days of Standard tournaments (32+ players) from the Limitless API and, per archetype, computes:

- **meta share**, **win rate** (shrunk toward 50% for small samples) and **top-8 conversion**, combined into a 0 to 100 meta score
- a **representative list** (the best finisher's 60) plus how often each card shows up across all lists of that archetype

In the app, each deck gets a build score of `meta score × (weighted share of the list you own)²`. Core cards (in every list) weigh more than one-off techs. Missing the Pokémon the deck is named after is a big penalty. Rotated cards don't count when "Standard only" is on.

Known limits: cards match by name, so an older printing of a Pokémon with different attacks still counts (the list shows the set code so you can check). Limitless's public API covers online tournaments, which track the in-person meta closely but not perfectly.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173, also on your LAN
npm test
npm run meta       # refresh public/meta.json from Limitless
npm run index      # build/update the offline card index in public/card-index
npm run build
```

Phones only allow camera access over HTTPS (or localhost), so for real scanning use the deployed site.

## Deploying

`.github/workflows/deploy.yml` runs daily and on every push to `main`: tests, refreshes the meta and the card index, commits them if they changed, builds, and deploys to GitHub Pages. The very first run downloads ~10k card images to build the index, so give it a while. One-time setup: repo **Settings → Pages → Source: GitHub Actions**. Optional: add a `LIMITLESS_API_KEY` repo secret for higher rate limits.

Until the first CI run finishes, the Decks tab shows clearly-labelled sample data and the scanner falls back to reading text only.

## Privacy

Everything stays on the device: the collection is in IndexedDB, settings (including the optional API key) in localStorage. Use Settings → Export backup to move a collection to another device.

---

Card data and images from TCGdex; meta data from Limitless TCG. Not affiliated with Nintendo, Creatures, Game Freak or The Pokémon Company.
