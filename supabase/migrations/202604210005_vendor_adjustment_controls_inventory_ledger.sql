alter table public.vendor_adjustments
  add column if not exists status text not null default 'approved'
    check (status in ('draft', 'approved', 'void')),
  add column if not exists approved_by uuid references public.profiles (id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists voided_by uuid references public.profiles (id) on delete set null,
  add column if not exists voided_at timestamptz,
  add column if not exists attachment_name text,
  add column if not exists attachment_path text,
  add column if not exists attachment_url text,
  add column if not exists attachment_mime_type text;

update public.vendor_adjustments
set
  status = coalesce(status, 'approved'),
  approved_by = coalesce(approved_by, created_by),
  approved_at = coalesce(approved_at, created_at)
where status is null
   or (status = 'approved' and approved_at is null);

create index if not exists vendor_adjustments_store_status_date_idx
  on public.vendor_adjustments (store_key, status, adjustment_date desc);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  product_id uuid references public.products (id) on delete set null,
  vendor_adjustment_id uuid references public.vendor_adjustments (id) on delete set null,
  movement_type text not null
    check (movement_type in ('vendor_return', 'vendor_return_reversal')),
  quantity_delta integer not null,
  quantity_before integer not null,
  quantity_after integer not null,
  unit_cost numeric(12, 2) not null default 0,
  total_amount numeric(12, 2) not null default 0,
  product_name text not null,
  product_sku text not null,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists inventory_movements_store_product_created_idx
  on public.inventory_movements (store_key, product_id, created_at desc);

create index if not exists inventory_movements_store_adjustment_created_idx
  on public.inventory_movements (store_key, vendor_adjustment_id, created_at desc);

alter table public.inventory_movements enable row level security;

drop policy if exists "inventory_movements_select_management" on public.inventory_movements;
create policy "inventory_movements_select_management"
on public.inventory_movements
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "inventory_movements_manage_management" on public.inventory_movements;
create policy "inventory_movements_manage_management"
on public.inventory_movements
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));
