insert into storage.buckets (id, name, public)
values ('game-catalog', 'game-catalog', true)
on conflict (id) do update
set public = excluded.public;

create table if not exists public.game_catalog (
  id uuid primary key default gen_random_uuid(),
  game_id text not null,
  game_name text not null,
  ticket_price numeric(10, 2) not null,
  is_active boolean not null default true,
  image_path text not null,
  image_url text not null,
  source_file_name text,
  source_page integer,
  crop_index integer,
  imported_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint game_catalog_game_id_key unique (game_id),
  constraint game_catalog_ticket_price_nonnegative check (ticket_price >= 0)
);

create index if not exists game_catalog_game_name_idx
on public.game_catalog (game_name);

create index if not exists game_catalog_is_active_idx
on public.game_catalog (is_active);

drop trigger if exists game_catalog_set_updated_at on public.game_catalog;
create trigger game_catalog_set_updated_at
before update on public.game_catalog
for each row
execute function public.set_updated_at();

alter table public.game_catalog enable row level security;

drop policy if exists "game_catalog_select_staff" on public.game_catalog;
create policy "game_catalog_select_staff"
on public.game_catalog
for select
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier'])));

drop policy if exists "game_catalog_mutate_management" on public.game_catalog;
create policy "game_catalog_mutate_management"
on public.game_catalog
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager'])))
with check ((select public.is_current_user_role(array['admin', 'manager'])));

drop policy if exists "game_catalog_storage_select_staff" on storage.objects;
create policy "game_catalog_storage_select_staff"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'game-catalog'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier']))
);

drop policy if exists "game_catalog_storage_insert_management" on storage.objects;
create policy "game_catalog_storage_insert_management"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'game-catalog'
  and (select public.is_current_user_role(array['admin', 'manager']))
);

drop policy if exists "game_catalog_storage_update_management" on storage.objects;
create policy "game_catalog_storage_update_management"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'game-catalog'
  and (select public.is_current_user_role(array['admin', 'manager']))
)
with check (
  bucket_id = 'game-catalog'
  and (select public.is_current_user_role(array['admin', 'manager']))
);

drop policy if exists "game_catalog_storage_delete_management" on storage.objects;
create policy "game_catalog_storage_delete_management"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'game-catalog'
  and (select public.is_current_user_role(array['admin', 'manager']))
);
