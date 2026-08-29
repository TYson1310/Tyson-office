-- Migration: expense controls and tax split
-- Description: add vendor linkage, tax split, and document-control fields for expenses and recurring templates.

alter table public.expense_records
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null,
  add column if not exists subtotal_amount numeric(12, 2),
  add column if not exists tax_amount numeric(12, 2) not null default 0;

update public.expense_records
set
  subtotal_amount = coalesce(subtotal_amount, amount),
  tax_amount = coalesce(tax_amount, 0)
where subtotal_amount is null
   or tax_amount is null;

alter table public.expense_records
  alter column subtotal_amount set not null;

alter table public.expense_records
  drop constraint if exists expense_records_subtotal_amount_nonnegative_check,
  add constraint expense_records_subtotal_amount_nonnegative_check
    check (subtotal_amount >= 0),
  drop constraint if exists expense_records_tax_amount_nonnegative_check,
  add constraint expense_records_tax_amount_nonnegative_check
    check (tax_amount >= 0),
  drop constraint if exists expense_records_total_breakdown_check,
  add constraint expense_records_total_breakdown_check
    check (abs((subtotal_amount + tax_amount) - amount) <= 0.01);

create index if not exists expense_records_store_key_supplier_id_expense_date_idx
  on public.expense_records (store_key, supplier_id, expense_date desc)
  where supplier_id is not null;

create index if not exists expense_records_store_key_active_duplicate_scan_idx
  on public.expense_records (store_key, expense_date desc, amount, category, supplier_id)
  where status in ('draft', 'approved');

alter table public.recurring_expense_templates
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null,
  add column if not exists default_tax_amount numeric(12, 2) not null default 0;

update public.recurring_expense_templates
set default_tax_amount = coalesce(default_tax_amount, 0)
where default_tax_amount is null;

alter table public.recurring_expense_templates
  drop constraint if exists recurring_expense_templates_default_tax_amount_nonnegative_check,
  add constraint recurring_expense_templates_default_tax_amount_nonnegative_check
    check (default_tax_amount >= 0),
  drop constraint if exists recurring_expense_templates_default_total_breakdown_check,
  add constraint recurring_expense_templates_default_total_breakdown_check
    check (abs(((default_amount - default_tax_amount) + default_tax_amount) - default_amount) <= 0.01),
  drop constraint if exists recurring_expense_templates_default_tax_amount_total_check,
  add constraint recurring_expense_templates_default_tax_amount_total_check
    check (default_tax_amount <= default_amount);

create index if not exists recurring_expense_templates_store_key_supplier_due_day_idx
  on public.recurring_expense_templates (store_key, supplier_id, due_day_of_month)
  where supplier_id is not null;
