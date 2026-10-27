create table if not exists public.pos_cash_eod_reviews (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete cascade,
  business_date date not null,
  pos_cash_counted numeric(12, 2) not null default 0,
  opening_float numeric(12, 2) not null default 0,
  closing_float numeric(12, 2) not null default 0,
  total_payouts numeric(12, 2) not null default 0,
  nrs_import_id uuid references public.nrs_email_imports (id) on delete set null,
  nrs_cash_total numeric(12, 2),
  variance numeric(12, 2),
  notes text,
  status text not null default 'counted'
    check (status in ('counted', 'approved')),
  counted_by uuid references public.profiles (id) on delete set null,
  counted_at timestamptz not null default timezone('utc', now()),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint pos_cash_eod_reviews_store_date_unique unique (store_key, business_date),
  constraint pos_cash_eod_reviews_amounts_nonnegative check (
    pos_cash_counted >= 0 and opening_float >= 0 and closing_float >= 0
    and total_payouts >= 0 and (nrs_cash_total is null or nrs_cash_total >= 0)
  )
);

drop trigger if exists pos_cash_eod_reviews_set_updated_at
  on public.pos_cash_eod_reviews;
create trigger pos_cash_eod_reviews_set_updated_at
before update on public.pos_cash_eod_reviews
for each row execute function public.set_updated_at();

create index if not exists pos_cash_eod_reviews_store_date_idx
  on public.pos_cash_eod_reviews (store_key, business_date desc);

alter table public.pos_cash_eod_reviews enable row level security;

drop policy if exists "pos_cash_eod_reviews_select_staff"
  on public.pos_cash_eod_reviews;
create policy "pos_cash_eod_reviews_select_staff"
on public.pos_cash_eod_reviews
for select to authenticated
using ((select public.can_access_store(
  store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee']
)));

drop policy if exists "pos_cash_eod_reviews_manage_staff"
  on public.pos_cash_eod_reviews;
create policy "pos_cash_eod_reviews_manage_staff"
on public.pos_cash_eod_reviews
for all to authenticated
using ((select public.can_access_store(
  store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee']
)))
with check ((select public.can_access_store(
  store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee']
)));
