alter table public.products
  add column if not exists barcode text;

update public.products
set barcode = sku
where barcode is null
  and sku ~ '^[0-9]{8,14}$';

create index if not exists products_store_barcode_idx
  on public.products (store_key, barcode)
  where barcode is not null;
