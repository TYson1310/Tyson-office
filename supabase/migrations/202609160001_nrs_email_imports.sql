create table if not exists public.nrs_email_imports (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete cascade,
  business_date date not null,
  sales_file_name text not null,
  inventory_file_name text not null,
  sales_file_hash text not null,
  inventory_file_hash text not null,
  sales_total numeric(12, 2) not null default 0,
  item_count integer not null default 0,
  sales_line_count integer not null default 0,
  inventory_row_count integer not null default 0,
  inventory_updated_count integer not null default 0,
  status text not null default 'processing'
    check (status in ('processing', 'imported', 'failed')),
  error_message text,
  imported_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint nrs_email_imports_store_date_unique
    unique (store_key, business_date)
);

drop trigger if exists nrs_email_imports_set_updated_at
  on public.nrs_email_imports;
create trigger nrs_email_imports_set_updated_at
before update on public.nrs_email_imports
for each row
execute function public.set_updated_at();

create index if not exists nrs_email_imports_store_date_idx
  on public.nrs_email_imports (store_key, business_date desc);

alter table public.nrs_email_imports enable row level security;

drop policy if exists "nrs_email_imports_select_staff"
  on public.nrs_email_imports;
create policy "nrs_email_imports_select_staff"
on public.nrs_email_imports
for select
to authenticated
using (
  (select public.can_access_store(
    store_key,
    array['admin', 'manager', 'accountant']::text[]
  ))
);
