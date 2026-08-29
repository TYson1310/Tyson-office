-- Migration: expense category budgets
-- Description: monthly category budgets for expense budget-vs-actual reporting.

create table if not exists public.expense_category_budgets (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  budget_month date not null,
  category text not null,
  budget_amount numeric(12, 2) not null check (budget_amount > 0),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint expense_category_budgets_month_start_check
    check (date_trunc('month', budget_month)::date = budget_month)
);

drop trigger if exists expense_category_budgets_set_updated_at on public.expense_category_budgets;
create trigger expense_category_budgets_set_updated_at
before update on public.expense_category_budgets
for each row
execute function public.set_updated_at();

alter table public.expense_category_budgets enable row level security;

drop policy if exists "expense_category_budgets_select_management" on public.expense_category_budgets;
create policy "expense_category_budgets_select_management"
on public.expense_category_budgets
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "expense_category_budgets_manage_management" on public.expense_category_budgets;
create policy "expense_category_budgets_manage_management"
on public.expense_category_budgets
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

create unique index if not exists expense_category_budgets_store_key_month_category_uniq
  on public.expense_category_budgets (store_key, budget_month, category);

create index if not exists expense_category_budgets_store_key_month_idx
  on public.expense_category_budgets (store_key, budget_month desc, category);
