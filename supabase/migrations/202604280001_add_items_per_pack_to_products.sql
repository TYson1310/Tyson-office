-- Migration: add items per pack to products
-- Description: tracks how many saleable units are contained in each pack.

alter table public.products
add column if not exists items_per_pack integer not null default 1;

alter table public.products
drop constraint if exists products_items_per_pack_positive;

alter table public.products
add constraint products_items_per_pack_positive
check (items_per_pack > 0);
