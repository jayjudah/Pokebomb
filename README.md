# Pokebomb

Scan a Pokémon card collection with your phone camera, then find out which competitive deck you can build from it.

- **Continuous scanning.** Point the phone at a spot on the table and slide cards under it one after another. The app waits for each new card to settle, reads it, beeps, and adds it. No tapping between cards. Duplicates count.
- **Collection tracker.** Card images, quantities, set progress, Standard legality, rough market value, search and filters. Export/import backups (JSON) or CSV.
- **Meta deck advisor.** Pulls recent tournament results from [Limitless TCG](https://play.limitlesstcg.com), ranks the archetypes, and scores each one against your collection: how strong the deck is × how much of it you already own. Tap a deck to see exactly which cards you're missing, most important first, and copy the list into Pokémon TCG Live.

It's a web app (PWA). Open it on a phone, "Add to Home Screen", and it behaves like a native app, including offline use after the first load.

## How scanning works

Two engines, switchable on the scan screen:

| | On-device (default) | AI scan |
|---|---|---|
| How | Tesseract OCR reads the name (top) and collector number (bottom left, e.g. `130/167`) | Sends one still photo of the card to Claude |
| Cost | Free | Your Anthropic API key, a fraction of a cent per card |
| Offline | Yes, after first use | No |
| Good at | Regular cards in decent light | Holos, full arts, glare, odd layouts |

Either way, the name and number get matched against [TCGdex](https://tcgdex.dev). The number's denominator (`/167`) narrows it to a few sets and the name picks the right one. If the app isn't sure, it asks ("Is this it?") instead of adding the wrong card.

Tips: good even light, avoid glare on the bottom strip, fill the frame. A cheap phone stand makes the "slide cards through" flow much nicer. Add `?debug` to the URL to log what the OCR reads.

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
npm run build
```

Phones only allow camera access over HTTPS (or localhost), so for real scanning use the deployed site.

## Deploying

`.github/workflows/deploy.yml` runs daily and on every push to `main`: tests, refreshes the meta, commits `public/meta.json` if it changed, builds, and deploys to GitHub Pages. One-time setup: repo **Settings → Pages → Source: GitHub Actions**. Optional: add a `LIMITLESS_API_KEY` repo secret for higher rate limits.

Until the first real meta fetch runs, the Decks tab shows clearly-labelled sample data.

## Privacy

Everything stays on the device: the collection is in IndexedDB, settings (including the optional API key) in localStorage. Use Settings → Export backup to move a collection to another device.

---

Card data and images from TCGdex; meta data from Limitless TCG. Not affiliated with Nintendo, Creatures, Game Freak or The Pokémon Company.
