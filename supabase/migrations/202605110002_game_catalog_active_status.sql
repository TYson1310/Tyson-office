alter table public.game_catalog
add column if not exists is_active boolean not null default true;

create index if not exists game_catalog_is_active_idx
on public.game_catalog (is_active);
