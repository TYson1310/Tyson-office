create table if not exists public.game_catalog_prizes (
  id uuid primary key default gen_random_uuid(),
  game_id text not null references public.game_catalog (game_id) on delete cascade,
  prize_rank integer not null,
  prize_amount text not null,
  remaining_count integer not null,
  source_text text,
  source_page integer,
  imported_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint game_catalog_prizes_rank_nonnegative check (prize_rank >= 1),
  constraint game_catalog_prizes_remaining_nonnegative check (remaining_count >= 0)
);

create unique index if not exists game_catalog_prizes_game_rank_key
on public.game_catalog_prizes (game_id, prize_rank);

create index if not exists game_catalog_prizes_game_id_idx
on public.game_catalog_prizes (game_id);

drop trigger if exists game_catalog_prizes_set_updated_at on public.game_catalog_prizes;
create trigger game_catalog_prizes_set_updated_at
before update on public.game_catalog_prizes
for each row
execute function public.set_updated_at();

alter table public.game_catalog_prizes enable row level security;

drop policy if exists "game_catalog_prizes_select_staff" on public.game_catalog_prizes;
create policy "game_catalog_prizes_select_staff"
on public.game_catalog_prizes
for select
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier'])));

drop policy if exists "game_catalog_prizes_mutate_management" on public.game_catalog_prizes;
create policy "game_catalog_prizes_mutate_management"
on public.game_catalog_prizes
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager'])))
with check ((select public.is_current_user_role(array['admin', 'manager'])));
