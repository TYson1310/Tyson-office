create table if not exists public.vendor_adjustments (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  vendor_invoice_id uuid references public.vendor_invoices (id) on delete set null,
  adjustment_number text not null,
  adjustment_type text not null
    check (adjustment_type in ('return', 'credit_note', 'shortage', 'damage', 'rebate', 'other')),
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  currency text not null default 'USD',
  adjustment_date date not null,
  reason text,
  notes text,
  inventory_impact boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists vendor_adjustments_set_updated_at on public.vendor_adjustments;
create trigger vendor_adjustments_set_updated_at
before update on public.vendor_adjustments
for each row
execute function public.set_updated_at();

create table if not exists public.vendor_adjustment_items (
  id uuid primary key default gen_random_uuid(),
  vendor_adjustment_id uuid not null references public.vendor_adjustments (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  description text not null,
  quantity integer not null default 0 check (quantity >= 0),
  unit_cost numeric(12, 2) not null default 0 check (unit_cost >= 0),
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists vendor_adjustments_store_number_unique_idx
  on public.vendor_adjustments (store_key, adjustment_number);

create index if not exists vendor_adjustments_store_supplier_date_idx
  on public.vendor_adjustments (store_key, supplier_id, adjustment_date desc);

create index if not exists vendor_adjustments_store_invoice_date_idx
  on public.vendor_adjustments (store_key, vendor_invoice_id, adjustment_date desc);

create index if not exists vendor_adjustment_items_adjustment_id_idx
  on public.vendor_adjustment_items (vendor_adjustment_id);

alter table public.vendor_adjustments enable row level security;
alter table public.vendor_adjustment_items enable row level security;

drop policy if exists "vendor_adjustments_select_management" on public.vendor_adjustments;
create policy "vendor_adjustments_select_management"
on public.vendor_adjustments
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "vendor_adjustments_manage_management" on public.vendor_adjustments;
create policy "vendor_adjustments_manage_management"
on public.vendor_adjustments
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "vendor_adjustment_items_select_management" on public.vendor_adjustment_items;
create policy "vendor_adjustment_items_select_management"
on public.vendor_adjustment_items
for select
to authenticated
using (
  exists (
    select 1
    from public.vendor_adjustments
    where public.vendor_adjustments.id = vendor_adjustment_items.vendor_adjustment_id
      and (select public.can_access_store(public.vendor_adjustments.store_key, array['admin', 'manager', 'accountant']))
  )
);

drop policy if exists "vendor_adjustment_items_manage_management" on public.vendor_adjustment_items;
create policy "vendor_adjustment_items_manage_management"
on public.vendor_adjustment_items
for all
to authenticated
using (
  exists (
    select 1
    from public.vendor_adjustments
    where public.vendor_adjustments.id = vendor_adjustment_items.vendor_adjustment_id
      and (select public.can_access_store(public.vendor_adjustments.store_key, array['admin', 'manager', 'accountant']))
  )
)
with check (
  exists (
    select 1
    from public.vendor_adjustments
    where public.vendor_adjustments.id = vendor_adjustment_items.vendor_adjustment_id
      and (select public.can_access_store(public.vendor_adjustments.store_key, array['admin', 'manager', 'accountant']))
  )
);
