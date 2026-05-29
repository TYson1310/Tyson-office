-- Migration: lottery cash advances
-- Description: Track authorized lottery drawer cash advances and paybacks.

create table if not exists public.lottery_cash_advances (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  advance_date date not null default current_date,
  person_name text not null check (length(btrim(person_name)) > 0),
  amount numeric(12, 2) not null check (amount > 0),
  reason text not null check (length(btrim(reason)) > 0),
  expected_payback_date date,
  notes text,
  status text not null default 'posted' check (status in ('posted', 'void')),
  voided_by uuid references public.profiles (id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lottery_cash_advances_expected_payback_check
    check (expected_payback_date is null or expected_payback_date >= advance_date)
);

create table if not exists public.lottery_cash_advance_payments (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  advance_id uuid not null references public.lottery_cash_advances (id) on delete restrict,
  payment_date date not null default current_date,
  amount numeric(12, 2) not null check (amount > 0),
  notes text,
  status text not null default 'posted' check (status in ('posted', 'void')),
  voided_by uuid references public.profiles (id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists lottery_cash_advances_store_date_status_idx
  on public.lottery_cash_advances (store_key, advance_date desc, status);

create index if not exists lottery_cash_advances_store_status_created_idx
  on public.lottery_cash_advances (store_key, status, created_at desc);

create index if not exists lottery_cash_advance_payments_store_date_status_idx
  on public.lottery_cash_advance_payments (store_key, payment_date desc, status);

create index if not exists lottery_cash_advance_payments_advance_status_idx
  on public.lottery_cash_advance_payments (advance_id, status, payment_date desc);

alter table public.lottery_cash_advances enable row level security;
alter table public.lottery_cash_advance_payments enable row level security;

drop policy if exists "lottery_cash_advances_select_staff" on public.lottery_cash_advances;
create policy "lottery_cash_advances_select_staff"
on public.lottery_cash_advances
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

drop policy if exists "lottery_cash_advances_manage_management" on public.lottery_cash_advances;
create policy "lottery_cash_advances_manage_management"
on public.lottery_cash_advances
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager'])));

drop policy if exists "lottery_cash_advance_payments_select_staff" on public.lottery_cash_advance_payments;
create policy "lottery_cash_advance_payments_select_staff"
on public.lottery_cash_advance_payments
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

drop policy if exists "lottery_cash_advance_payments_manage_management" on public.lottery_cash_advance_payments;
create policy "lottery_cash_advance_payments_manage_management"
on public.lottery_cash_advance_payments
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager'])));

drop trigger if exists lottery_cash_advances_set_updated_at on public.lottery_cash_advances;
create trigger lottery_cash_advances_set_updated_at
before update on public.lottery_cash_advances
for each row
execute function public.set_updated_at();

drop trigger if exists lottery_cash_advance_payments_set_updated_at on public.lottery_cash_advance_payments;
create trigger lottery_cash_advance_payments_set_updated_at
before update on public.lottery_cash_advance_payments
for each row
execute function public.set_updated_at();

drop trigger if exists lottery_cash_advances_accounting_period_lock on public.lottery_cash_advances;
create trigger lottery_cash_advances_accounting_period_lock
before insert or update or delete on public.lottery_cash_advances
for each row execute function public.prevent_closed_accounting_period_changes('advance_date');

drop trigger if exists lottery_cash_advance_payments_accounting_period_lock on public.lottery_cash_advance_payments;
create trigger lottery_cash_advance_payments_accounting_period_lock
before insert or update or delete on public.lottery_cash_advance_payments
for each row execute function public.prevent_closed_accounting_period_changes('payment_date');
