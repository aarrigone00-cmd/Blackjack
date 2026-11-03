-- Player profiles: one row per signed-in user, readable/writable only by that user.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 50),
  bio text check (char_length(bio) <= 280),
  avatar_url text check (char_length(avatar_url) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'One player profile per signed-in user.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

revoke all on public.profiles from anon;
grant select, insert, update on public.profiles to authenticated;
