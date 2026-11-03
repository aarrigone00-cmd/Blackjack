-- Hand tracking: every hand played, every decision made, and the strategy in use.
-- Each table is private to its owner via row-level security.

-- ---------- Strategies ----------
create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (char_length(description) <= 500),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
comment on table public.strategies is 'Named playing strategies a player tags hands with.';

-- ---------- Hands ----------
create table public.hands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  strategy_id uuid references public.strategies (id) on delete set null,
  played_at timestamptz not null default now(),
  deck_id text,
  deck_count smallint not null default 1,
  cards_remaining smallint,                       -- cards left in the shoe before the deal
  bank_before integer not null check (bank_before >= 0),
  bet integer not null check (bet > 0),           -- opening bet
  final_bet integer not null check (final_bet >= bet),
  doubled boolean not null default false,
  player_cards text[] not null,                   -- card codes in order dealt, e.g. {AS,0H}
  dealer_cards text[] not null,
  dealer_upcard text not null,
  dealer_upcard_value smallint not null check (dealer_upcard_value between 2 and 11),
  player_start_total smallint not null,
  player_start_soft boolean not null,
  player_start_pair boolean not null,
  player_final_total smallint not null,
  dealer_final_total smallint not null,
  player_blackjack boolean not null default false,
  dealer_blackjack boolean not null default false,
  player_bust boolean not null default false,
  dealer_bust boolean not null default false,
  outcome text not null check (outcome in ('blackjack', 'win', 'push', 'loss')),
  net integer not null,                           -- chips won (+) or lost (-)
  bank_after integer not null check (bank_after >= 0),
  decisions smallint not null default 0,
  basic_strategy_deviations smallint not null default 0
);
comment on table public.hands is 'One row per hand of Blackjack played.';
create index hands_user_played_idx on public.hands (user_id, played_at desc);
create index hands_strategy_idx on public.hands (strategy_id);

-- ---------- Decisions ----------
create table public.hand_actions (
  id bigint generated always as identity primary key,
  hand_id uuid not null references public.hands (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  seq smallint not null,                          -- 1 = first decision of the hand
  action text not null check (action in ('hit', 'stand', 'double')),
  player_total smallint not null,                 -- total when the decision was made
  player_soft boolean not null,
  card_count smallint not null,                   -- cards in hand when deciding
  dealer_upcard_value smallint not null check (dealer_upcard_value between 2 and 11),
  recommended_action text check (recommended_action in ('hit', 'stand', 'double')),
  matches_basic boolean,
  card_drawn text,                                -- card received (hit/double)
  total_after smallint,
  unique (hand_id, seq)
);
comment on table public.hand_actions is 'Every hit/stand/double decision, with the game state and the basic-strategy recommendation.';
create index hand_actions_user_idx on public.hand_actions (user_id);

-- ---------- Row-level security ----------
alter table public.strategies enable row level security;
alter table public.hands enable row level security;
alter table public.hand_actions enable row level security;

create policy "Own strategies: read"   on public.strategies for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own strategies: create" on public.strategies for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own strategies: update" on public.strategies for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own strategies: delete" on public.strategies for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Own hands: read" on public.hands for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own hands: create" on public.hands for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (strategy_id is null or exists (
      select 1 from public.strategies s where s.id = strategy_id and s.user_id = (select auth.uid())))
  );

create policy "Own decisions: read" on public.hand_actions for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own decisions: create" on public.hand_actions for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.hands h where h.id = hand_id and h.user_id = (select auth.uid()))
  );

revoke all on public.strategies, public.hands, public.hand_actions from anon;
grant select, insert, update, delete on public.strategies to authenticated;
grant select, insert on public.hands, public.hand_actions to authenticated;

-- ---------- Save a hand and its decisions in one transaction ----------
create or replace function public.record_hand(hand jsonb, actions jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into public.hands (
    strategy_id, deck_id, deck_count, cards_remaining, bank_before, bet, final_bet, doubled,
    player_cards, dealer_cards, dealer_upcard, dealer_upcard_value,
    player_start_total, player_start_soft, player_start_pair,
    player_final_total, dealer_final_total, player_blackjack, dealer_blackjack,
    player_bust, dealer_bust, outcome, net, bank_after, decisions, basic_strategy_deviations
  )
  select
    r.strategy_id, r.deck_id, coalesce(r.deck_count, 1), r.cards_remaining, r.bank_before, r.bet, r.final_bet,
    coalesce(r.doubled, false), r.player_cards, r.dealer_cards, r.dealer_upcard, r.dealer_upcard_value,
    r.player_start_total, r.player_start_soft, r.player_start_pair,
    r.player_final_total, r.dealer_final_total, coalesce(r.player_blackjack, false), coalesce(r.dealer_blackjack, false),
    coalesce(r.player_bust, false), coalesce(r.dealer_bust, false), r.outcome, r.net, r.bank_after,
    coalesce(r.decisions, 0), coalesce(r.basic_strategy_deviations, 0)
  from jsonb_populate_record(null::public.hands, hand) as r
  returning id into new_id;

  insert into public.hand_actions (
    hand_id, seq, action, player_total, player_soft, card_count, dealer_upcard_value,
    recommended_action, matches_basic, card_drawn, total_after
  )
  select
    new_id, a.seq, a.action, a.player_total, a.player_soft, a.card_count, a.dealer_upcard_value,
    a.recommended_action, a.matches_basic, a.card_drawn, a.total_after
  from jsonb_populate_recordset(null::public.hand_actions, coalesce(actions, '[]'::jsonb)) as a;

  return new_id;
end;
$$;

revoke execute on function public.record_hand(jsonb, jsonb) from public, anon;
grant execute on function public.record_hand(jsonb, jsonb) to authenticated;

-- ---------- Modeling dataset: one row per decision with its hand's result ----------
create view public.decision_log
with (security_invoker = true)
as
select
  a.hand_id,
  a.user_id,
  h.played_at,
  s.name as strategy,
  a.seq,
  a.player_total,
  a.player_soft,
  a.card_count,
  a.dealer_upcard_value,
  a.action,
  a.recommended_action,
  a.matches_basic,
  a.card_drawn,
  a.total_after,
  h.bet,
  h.final_bet,
  h.outcome,
  h.net,
  h.player_final_total,
  h.dealer_final_total
from public.hand_actions a
join public.hands h on h.id = a.hand_id
left join public.strategies s on s.id = h.strategy_id;

comment on view public.decision_log is 'Decision-level dataset for analysis/modeling. Respects RLS of the underlying tables.';
revoke all on public.decision_log from anon;
grant select on public.decision_log to authenticated;
