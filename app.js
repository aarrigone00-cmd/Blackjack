// Blackjack powered by https://deckofcardsapi.com/
const API = "https://deckofcardsapi.com/api/deck";
const DECK_COUNT = 1;
const RESHUFFLE_AT = 15; // reshuffle before a round when fewer cards remain
const CARD_BACK = "https://deckofcardsapi.com/static/img/back.png";
const STARTING_BANK = 1000;

const state = {
  deckId: null,
  remaining: 0,
  bank: STARTING_BANK,
  bet: 0,
  lastBet: 0,
  player: [],
  dealer: [],
  inRound: false,
  dealerHidden: true,
  busy: false,
};

const $ = (id) => document.getElementById(id);
const els = {
  bank: $("bank"),
  bet: $("bet"),
  remaining: $("remaining"),
  dealerCards: $("dealer-cards"),
  playerCards: $("player-cards"),
  dealerScore: $("dealer-score"),
  playerScore: $("player-score"),
  message: $("message"),
  betting: $("betting"),
  actions: $("actions"),
  deal: $("deal"),
  hit: $("hit"),
  stand: $("stand"),
  double: $("double"),
  clearBet: $("clear-bet"),
  reset: $("reset"),
};

// ---------- API ----------

async function api(path) {
  const res = await fetch(`${API}/${path}`);
  if (!res.ok) throw new Error(`Deck API error (${res.status})`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Deck API request failed");
  return data;
}

async function newDeck() {
  const data = await api(`new/shuffle/?deck_count=${DECK_COUNT}`);
  state.deckId = data.deck_id;
  state.remaining = data.remaining;
}

// Returns all drawn cards to the deck and shuffles it.
async function reshuffle() {
  const data = await api(`${state.deckId}/shuffle/`);
  state.remaining = data.remaining;
}

async function draw(count) {
  if (state.remaining < count) await reshuffle();
  const data = await api(`${state.deckId}/draw/?count=${count}`);
  state.remaining = data.remaining;
  return data.cards;
}

// ---------- Scoring ----------

function cardValue(card) {
  if (card.value === "ACE") return 11;
  if (["KING", "QUEEN", "JACK"].includes(card.value)) return 10;
  return Number(card.value);
}

function handScore(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.value === "ACE") aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

const isBlackjack = (cards) => cards.length === 2 && handScore(cards) === 21;

// ---------- Rendering ----------

function cardImg(src, alt) {
  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  return img;
}

function render() {
  els.bank.textContent = `$${state.bank}`;
  els.bet.textContent = `$${state.bet}`;
  els.remaining.textContent = state.deckId ? state.remaining : "–";

  els.playerCards.replaceChildren(
    ...state.player.map((c) => cardImg(c.image, `${c.value} of ${c.suit}`))
  );
  els.dealerCards.replaceChildren(
    ...state.dealer.map((c, i) =>
      i === 1 && state.dealerHidden
        ? cardImg(CARD_BACK, "Face-down card")
        : cardImg(c.image, `${c.value} of ${c.suit}`)
    )
  );

  els.playerScore.textContent = state.player.length ? handScore(state.player) : "";
  els.dealerScore.textContent = !state.dealer.length
    ? ""
    : state.dealerHidden
      ? handScore([state.dealer[0]])
      : handScore(state.dealer);

  const ready = Boolean(state.deckId) && !state.busy;
  els.betting.hidden = state.inRound;
  els.actions.hidden = !state.inRound;
  els.deal.disabled = !ready || state.bet <= 0;
  els.clearBet.disabled = !ready || state.bet <= 0;
  document.querySelectorAll("[data-chip]").forEach((b) => {
    b.disabled = !ready || state.bet + Number(b.dataset.chip) > state.bank;
  });
  els.hit.disabled = !ready;
  els.stand.disabled = !ready;
  els.double.disabled = !ready || state.player.length !== 2 || state.bank < state.bet;
  els.reset.hidden = state.inRound || state.bank > 0 || state.bet > 0;
}

function say(text, isError = false) {
  els.message.textContent = text;
  els.message.classList.toggle("error", isError);
}

// Wraps an async action so buttons are disabled while it runs and errors are shown.
async function run(fn) {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    await fn();
  } catch (err) {
    console.error(err);
    say(`${err.message}. Check your connection and try again.`, true);
  } finally {
    state.busy = false;
    render();
  }
}

// ---------- Game flow ----------

async function deal() {
  if (state.remaining < RESHUFFLE_AT) {
    say("Shuffling…");
    await reshuffle();
  }
  const cards = await draw(4);

  state.bank -= state.bet;
  state.lastBet = state.bet;
  state.player = [cards[0], cards[2]];
  state.dealer = [cards[1], cards[3]];
  state.dealerHidden = true;
  state.inRound = true;
  say("Hit or stand?");

  if (isBlackjack(state.player) || isBlackjack(state.dealer)) settle();
}

async function hit() {
  const [card] = await draw(1);
  state.player.push(card);
  const score = handScore(state.player);
  if (score > 21) settle();
  else if (score === 21) await dealerTurn();
}

async function doubleDown() {
  state.bank -= state.bet;
  state.bet *= 2;
  const [card] = await draw(1);
  state.player.push(card);
  if (handScore(state.player) > 21) settle();
  else await dealerTurn();
}

async function dealerTurn() {
  state.dealerHidden = false;
  render();
  // Dealer stands on all 17s.
  while (handScore(state.dealer) < 17) {
    await new Promise((r) => setTimeout(r, 450));
    const [card] = await draw(1);
    state.dealer.push(card);
    render();
  }
  settle();
}

function settle() {
  state.dealerHidden = false;
  const p = handScore(state.player);
  const d = handScore(state.dealer);
  const playerBJ = isBlackjack(state.player);
  const dealerBJ = isBlackjack(state.dealer);
  const bet = state.bet;
  let msg;

  if (playerBJ && dealerBJ) {
    state.bank += bet;
    msg = "Both have Blackjack — push.";
  } else if (playerBJ) {
    const win = Math.floor(bet * 1.5);
    state.bank += bet + win;
    msg = `Blackjack! You win $${win}.`;
  } else if (dealerBJ) {
    msg = `Dealer has Blackjack. You lose $${bet}.`;
  } else if (p > 21) {
    msg = `Bust! You lose $${bet}.`;
  } else if (d > 21) {
    state.bank += bet * 2;
    msg = `Dealer busts! You win $${bet}.`;
  } else if (p > d) {
    state.bank += bet * 2;
    msg = `You win $${bet}! ${p} beats ${d}.`;
  } else if (p < d) {
    msg = `Dealer wins, ${d} to ${p}. You lose $${bet}.`;
  } else {
    state.bank += bet;
    msg = `Push at ${p}.`;
  }

  state.inRound = false;
  // Keep the same bet for the next hand if affordable.
  state.bet = state.lastBet <= state.bank ? state.lastBet : 0;
  if (state.bank <= 0) msg += " You're out of money.";
  else msg += " Place a bet and deal again.";
  say(msg);
}

// ---------- Events ----------

document.querySelectorAll("[data-chip]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const amount = Number(btn.dataset.chip);
    if (state.inRound || state.bet + amount > state.bank) return;
    state.bet += amount;
    render();
  })
);

els.clearBet.addEventListener("click", () => {
  state.bet = 0;
  render();
});

els.deal.addEventListener("click", () => {
  if (state.bet > 0 && state.bet <= state.bank) run(deal);
});
els.hit.addEventListener("click", () => run(hit));
els.stand.addEventListener("click", () => run(dealerTurn));
els.double.addEventListener("click", () => run(doubleDown));

els.reset.addEventListener("click", () => {
  state.bank = STARTING_BANK;
  state.bet = 0;
  state.lastBet = 0;
  state.player = [];
  state.dealer = [];
  say("Fresh bankroll. Place a bet to start.");
  render();
});

run(async () => {
  await newDeck();
  say("Place a bet to start.");
});
