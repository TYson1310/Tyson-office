-- Migration: recurring expense templates
-- Description: monthly recurring expense templates with linked draft generation safeguards.

create table if not exists public.recurring_expense_templates (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  category text not null,
  default_amount numeric(12, 2) not null check (default_amount > 0),
  description text not null,
  due_day_of_month integer not null check (due_day_of_month between 1 and 31),
  vendor_name text,
  payment_method text
    check (payment_method in ('cash', 'card', 'mobile', 'bank_transfer', 'check', 'other')),
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists recurring_expense_templates_set_updated_at on public.recurring_expense_templates;
create trigger recurring_expense_templates_set_updated_at
before update on public.recurring_expense_templates
for each row
execute function public.set_updated_at();

alter table public.recurring_expense_templates enable row level security;

drop policy if exists "recurring_expense_templates_select_management" on public.recurring_expense_templates;
create policy "recurring_expense_templates_select_management"
on public.recurring_expense_templates
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "recurring_expense_templates_manage_management" on public.recurring_expense_templates;
create policy "recurring_expense_templates_manage_management"
on public.recurring_expense_templates
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

create index if not exists recurring_expense_templates_store_key_active_due_day_idx
  on public.recurring_expense_templates (store_key, active, due_day_of_month, description);

alter table public.expense_records
  add column if not exists recurring_template_id uuid references public.recurring_expense_templates (id) on delete set null,
  add column if not exists recurring_period_month date;

create index if not exists expense_records_store_key_recurring_template_period_idx
  on public.expense_records (store_key, recurring_template_id, recurring_period_month desc)
  where recurring_template_id is not null
    and recurring_period_month is not null;

create unique index if not exists expense_records_store_key_recurring_template_period_active_uniq
  on public.expense_records (store_key, recurring_template_id, recurring_period_month)
  where recurring_template_id is not null
    and recurring_period_month is not null
    and status in ('draft', 'approved');
