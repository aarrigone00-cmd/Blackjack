# Blackjack

A browser Blackjack game built with plain HTML, CSS and JavaScript, using the free [Deck of Cards API](https://deckofcardsapi.com/) for shuffling, drawing and card images.

## How it works

| API call | Used for |
| --- | --- |
| `GET /api/deck/new/shuffle/?deck_count=1` | Create a shuffled deck on page load (stores `deck_id`) |
| `GET /api/deck/<deck_id>/draw/?count=N` | Deal 4 cards to start a hand, 1 card per hit/dealer draw |
| `GET /api/deck/<deck_id>/shuffle/` | Return all cards and reshuffle when fewer than 15 remain |

Rules: dealer stands on all 17s, Blackjack pays 3:2, double down on your first two cards, $1000 starting bankroll.

## Run locally

No build step. Serve the folder with any static server, e.g.:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy to Netlify

The repo root is the site (`netlify.toml` sets `publish = "."`). Either connect the GitHub repo in Netlify (no build command), or drag the project folder onto https://app.netlify.com/drop.
