alter table public.vendor_payments
  add column if not exists status text not null default 'posted'
    check (status in ('posted', 'void')),
  add column if not exists voided_by uuid references public.profiles (id) on delete set null,
  add column if not exists voided_at timestamptz;

update public.vendor_payments
set
  status = coalesce(status, 'posted'),
  approved_at = coalesce(approved_at, created_at)
where status is null
   or (status = 'posted' and approved_at is null);

create index if not exists vendor_payments_store_status_payment_date_idx
  on public.vendor_payments (store_key, status, payment_date desc);

create index if not exists vendor_payments_store_invoice_posted_date_idx
  on public.vendor_payments (store_key, vendor_invoice_id, payment_date desc)
  where status = 'posted';

create index if not exists vendor_payments_store_supplier_posted_date_idx
  on public.vendor_payments (store_key, supplier_id, payment_date desc)
  where status = 'posted';

alter table public.store_settings
  add column if not exists accounting_close_through date,
  add column if not exists accounting_close_note text;

create index if not exists expense_records_store_key_draft_expense_date_idx
  on public.expense_records (store_key, expense_date desc)
  where status = 'draft';
