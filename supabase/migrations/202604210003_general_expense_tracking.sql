alter table public.expense_records
  add column if not exists vendor_name text,
  add column if not exists payment_method text
    check (payment_method in ('cash', 'card', 'mobile', 'bank_transfer', 'check', 'other')),
  add column if not exists notes text,
  add column if not exists created_by uuid references public.profiles (id) on delete set null,
  add column if not exists status text not null default 'approved'
    check (status in ('draft', 'approved')),
  add column if not exists approved_at timestamptz;

update public.expense_records
set status = 'approved'
where status is null;

update public.expense_records
set approved_at = coalesce(approved_at, created_at)
where status = 'approved'
  and approved_at is null;

create index if not exists expense_records_store_key_approved_expense_date_idx
  on public.expense_records (store_key, expense_date desc)
  where status = 'approved';

create index if not exists expense_records_store_key_category_approved_expense_date_idx
  on public.expense_records (store_key, category, expense_date desc)
  where status = 'approved';

create index if not exists expense_records_store_key_created_by_created_at_idx
  on public.expense_records (store_key, created_by, created_at desc);
