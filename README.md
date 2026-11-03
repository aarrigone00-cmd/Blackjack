# Blackjack

A browser Blackjack game built with plain HTML, CSS and JavaScript, using the free [Deck of Cards API](https://deckofcardsapi.com/) for shuffling, drawing and card images.

## How it works

| API call | Used for |
| --- | --- |
| `GET /api/deck/new/shuffle/?deck_count=1` | Create a shuffled deck on page load (stores `deck_id`) |
| `GET /api/deck/<deck_id>/draw/?count=N` | Deal 4 cards to start a hand, 1 card per hit/dealer draw |
| `GET /api/deck/<deck_id>/shuffle/` | Return all cards and reshuffle when fewer than 15 remain |

Rules: dealer stands on all 17s, Blackjack pays 3:2, double down on your first two cards, $1000 starting bankroll.

## Google sign-in (Supabase)

Players sign in with Google through Supabase Auth before they can play. Once signed in, the table greets them by first name and shows their Google profile picture. `auth.js` holds the Supabase project URL and publishable key (both are meant to be public).

Setup checklist:
- **Google Cloud → OAuth client:** Authorized JavaScript origin `https://<your-site>.netlify.app`; Authorized redirect URI `https://bkjajikcdsldpkulxxyx.supabase.co/auth/v1/callback`.
- **Supabase → Authentication → Sign In / Providers → Google:** enabled, with the Google client ID and secret.
- **Supabase → Authentication → URL Configuration:** Site URL `https://<your-site>.netlify.app`, and add it (plus `http://localhost:8000/` for local testing) to Redirect URLs.

## Player profiles

Signed-in players get a **Profile** tab where they create and edit a profile (username, display name, bio, photo). First-time players land on that tab automatically. Profiles live in the Supabase `public.profiles` table; row-level security lets each user read and write only their own row. The schema is in `supabase/migrations/`.

## Hand tracking & stats

Every hand is saved to Supabase when it settles, along with every hit/stand/double decision. Each decision records the situation (your total, soft/hard, dealer upcard) and what basic strategy recommends, so play can be graded and modeled. Players can tag hands with a named strategy from the picker on the Table tab, and the bankroll carries over between visits.

The **Stats** tab shows KPIs (net, win rate, return on wagers, basic-strategy match rate, busts, streaks…), auto-generated insights, net-over-time and win-rate-by-upcard charts, breakdowns by starting hand and strategy, recent hands, and CSV export of hands and decisions.

| Table / view | Contents |
| --- | --- |
| `strategies` | Named strategies per player |
| `hands` | One row per hand: cards, bets, totals, outcome, net, bankroll before/after, strategy |
| `hand_actions` | One row per decision: state, action, basic-strategy recommendation, card drawn |
| `decision_log` (view) | Decisions joined with hand results and strategy name, ready for modeling |
| `record_hand()` (function) | Saves a hand and its decisions in one transaction |

All of it is private to each player via row-level security. Schema: `supabase/migrations/`.

## Run locally

No build step. Serve the folder with any static server, e.g.:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy to Netlify

The repo root is the site (`netlify.toml` sets `publish = "."`). Either connect the GitHub repo in Netlify (no build command), or drag the project folder onto https://app.netlify.com/drop.
