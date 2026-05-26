-- Migration: Cash vault ledger
-- Description: Track every cash movement in a derived ledger and use it for vault balances.

create table if not exists public.cash_vault_transactions (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  source_table text not null,
  source_id uuid not null,
  movement_type text not null check (
    movement_type in (
      'cash_sale',
      'sales_payout',
      'cash_expense',
      'vendor_payment_cash',
      'payroll_cash',
      'bank_deposit'
    )
  ),
  business_date date not null,
  amount numeric(12, 2) not null,
  details text not null,
  metadata jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists cash_vault_transactions_source_unique_idx
  on public.cash_vault_transactions (source_table, source_id, movement_type);

create index if not exists cash_vault_transactions_store_key_recorded_at_idx
  on public.cash_vault_transactions (store_key, recorded_at desc, business_date desc);

alter table public.cash_vault_transactions enable row level security;

drop trigger if exists cash_vault_transactions_set_updated_at on public.cash_vault_transactions;
create trigger cash_vault_transactions_set_updated_at
before update on public.cash_vault_transactions
for each row
execute function public.set_updated_at();

drop policy if exists "cash_vault_transactions_select_management" on public.cash_vault_transactions;
create policy "cash_vault_transactions_select_management"
on public.cash_vault_transactions
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

create or replace function public.delete_cash_vault_transaction(
  p_source_table text,
  p_source_id uuid,
  p_movement_type text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.cash_vault_transactions
  where source_table = p_source_table
    and source_id = p_source_id
    and movement_type = p_movement_type;
end;
$$;

create or replace function public.upsert_cash_vault_transaction(
  p_store_key text,
  p_source_table text,
  p_source_id uuid,
  p_movement_type text,
  p_business_date date,
  p_amount numeric,
  p_details text,
  p_recorded_at timestamptz,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_store_key is null or p_source_id is null or coalesce(p_amount, 0) = 0 then
    perform public.delete_cash_vault_transaction(
      p_source_table,
      p_source_id,
      p_movement_type
    );
    return;
  end if;

  insert into public.cash_vault_transactions (
    store_key,
    source_table,
    source_id,
    movement_type,
    business_date,
    amount,
    details,
    metadata,
    recorded_at
  )
  values (
    p_store_key,
    p_source_table,
    p_source_id,
    p_movement_type,
    p_business_date,
    round(p_amount::numeric, 2),
    coalesce(nullif(btrim(p_details), ''), 'Cash movement logged'),
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_recorded_at, timezone('utc', now()))
  )
  on conflict (source_table, source_id, movement_type)
  do update set
    store_key = excluded.store_key,
    business_date = excluded.business_date,
    amount = excluded.amount,
    details = excluded.details,
    metadata = excluded.metadata,
    recorded_at = excluded.recorded_at,
    updated_at = timezone('utc', now());
end;
$$;

create or replace function public.sync_cash_vault_from_sales_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'daily_sales_summaries',
      old.id,
      'cash_sale'
    );
    return old;
  end if;

  if coalesce(new.cash_sales, 0) > 0 then
    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'daily_sales_summaries',
      new.id,
      'cash_sale',
      new.business_date,
      new.cash_sales,
      case
        when coalesce(new.line_count, 0) > 0
          then concat(new.line_count, ' sales lines logged as cash')
        else 'Cash sales recorded'
      end,
      coalesce(new.updated_at, new.created_at, timezone('utc', now())),
      jsonb_build_object(
        'cashSales', new.cash_sales,
        'lineCount', coalesce(new.line_count, 0),
        'reconciled', new.reconciled
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'daily_sales_summaries',
      new.id,
      'cash_sale'
    );
  end if;

  return new;
end;
$$;

create or replace function public.sync_cash_vault_from_sales_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'daily_sales_reconciliations',
      old.id,
      'sales_payout'
    );
    return old;
  end if;

  if new.status = 'approved' and coalesce(new.total_payouts, 0) > 0 then
    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'daily_sales_reconciliations',
      new.id,
      'sales_payout',
      new.reconciliation_date,
      new.total_payouts * -1,
      coalesce(
        nullif(btrim(new.notes), ''),
        'Sales payout recorded during closeout'
      ),
      coalesce(
        new.reconciled_at,
        new.updated_at,
        new.created_at,
        timezone('utc', now())
      ),
      jsonb_build_object(
        'status', new.status,
        'totalPayouts', new.total_payouts,
        'variance', new.variance
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'daily_sales_reconciliations',
      new.id,
      'sales_payout'
    );
  end if;

  return new;
end;
$$;

create or replace function public.sync_cash_vault_from_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'expense_records',
      old.id,
      'cash_expense'
    );
    return old;
  end if;

  if new.status = 'approved'
    and lower(coalesce(new.payment_method, '')) = 'cash'
    and coalesce(new.amount, 0) > 0
  then
    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'expense_records',
      new.id,
      'cash_expense',
      new.expense_date,
      new.amount * -1,
      concat_ws(
        ': ',
        nullif(btrim(new.category), ''),
        nullif(btrim(new.description), '')
      ),
      coalesce(new.approved_at, new.updated_at, new.created_at, timezone('utc', now())),
      jsonb_build_object(
        'category', new.category,
        'paymentMethod', new.payment_method,
        'status', new.status,
        'vendorName', new.vendor_name
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'expense_records',
      new.id,
      'cash_expense'
    );
  end if;

  return new;
end;
$$;

create or replace function public.sync_cash_vault_from_vendor_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  supplier_name text;
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'vendor_payments',
      old.id,
      'vendor_payment_cash'
    );
    return old;
  end if;

  if new.status = 'posted'
    and lower(coalesce(new.payment_method, '')) = 'cash'
    and coalesce(new.amount_paid, 0) > 0
  then
    select suppliers.name
    into supplier_name
    from public.suppliers
    where suppliers.id = new.supplier_id;

    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'vendor_payments',
      new.id,
      'vendor_payment_cash',
      new.payment_date,
      new.amount_paid * -1,
      concat_ws(
        ' · ',
        coalesce(nullif(btrim(supplier_name), ''), 'Vendor payment'),
        nullif(btrim(new.reference_number), '')
      ),
      coalesce(new.approved_at, new.updated_at, new.created_at, timezone('utc', now())),
      jsonb_build_object(
        'supplierId', new.supplier_id,
        'invoiceId', new.vendor_invoice_id,
        'referenceNumber', new.reference_number,
        'paymentMethod', new.payment_method,
        'status', new.status
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'vendor_payments',
      new.id,
      'vendor_payment_cash'
    );
  end if;

  return new;
end;
$$;

create or replace function public.sync_cash_vault_from_pay_statement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_label text;
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'pay_statements',
      old.id,
      'payroll_cash'
    );
    return old;
  end if;

  if new.status = 'paid'
    and lower(coalesce(new.payment_method, '')) = 'cash'
    and coalesce(new.net_pay, 0) > 0
  then
    select coalesce(nullif(btrim(profiles.full_name), ''), nullif(btrim(profiles.email), ''), 'Payroll')
    into employee_label
    from public.profiles
    where profiles.id = new.employee_id;

    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'pay_statements',
      new.id,
      'payroll_cash',
      new.pay_date,
      new.net_pay * -1,
      concat_ws(
        ' · ',
        coalesce(employee_label, 'Payroll'),
        nullif(btrim(new.period_label), '')
      ),
      coalesce(new.updated_at, new.created_at, timezone('utc', now())),
      jsonb_build_object(
        'employeeId', new.employee_id,
        'periodLabel', new.period_label,
        'paymentMethod', new.payment_method,
        'status', new.status
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'pay_statements',
      new.id,
      'payroll_cash'
    );
  end if;

  return new;
end;
$$;

create or replace function public.sync_cash_vault_from_bank_deposit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'bank_deposits',
      old.id,
      'bank_deposit'
    );
    return old;
  end if;

  if coalesce(new.amount, 0) > 0 then
    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'bank_deposits',
      new.id,
      'bank_deposit',
      new.deposit_date,
      new.amount * -1,
      coalesce(nullif(btrim(new.notes), ''), 'Deposit posted to bank'),
      coalesce(new.updated_at, new.created_at, timezone('utc', now())),
      jsonb_build_object(
        'createdBy', new.created_by,
        'slipPhotoUrl', new.slip_photo_url
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'bank_deposits',
      new.id,
      'bank_deposit'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists daily_sales_summaries_sync_cash_vault on public.daily_sales_summaries;
create trigger daily_sales_summaries_sync_cash_vault
after insert or update or delete on public.daily_sales_summaries
for each row
execute function public.sync_cash_vault_from_sales_summary();

drop trigger if exists daily_sales_reconciliations_sync_cash_vault on public.daily_sales_reconciliations;
create trigger daily_sales_reconciliations_sync_cash_vault
after insert or update or delete on public.daily_sales_reconciliations
for each row
execute function public.sync_cash_vault_from_sales_reconciliation();

drop trigger if exists expense_records_sync_cash_vault on public.expense_records;
create trigger expense_records_sync_cash_vault
after insert or update or delete on public.expense_records
for each row
execute function public.sync_cash_vault_from_expense();

drop trigger if exists vendor_payments_sync_cash_vault on public.vendor_payments;
create trigger vendor_payments_sync_cash_vault
after insert or update or delete on public.vendor_payments
for each row
execute function public.sync_cash_vault_from_vendor_payment();

drop trigger if exists pay_statements_sync_cash_vault on public.pay_statements;
create trigger pay_statements_sync_cash_vault
after insert or update or delete on public.pay_statements
for each row
execute function public.sync_cash_vault_from_pay_statement();

drop trigger if exists bank_deposits_sync_cash_vault on public.bank_deposits;
create trigger bank_deposits_sync_cash_vault
after insert or update or delete on public.bank_deposits
for each row
execute function public.sync_cash_vault_from_bank_deposit();

delete from public.cash_vault_transactions
where source_table in (
  'daily_sales_summaries',
  'daily_sales_reconciliations',
  'expense_records',
  'vendor_payments',
  'pay_statements',
  'bank_deposits'
);

insert into public.cash_vault_transactions (
  store_key,
  source_table,
  source_id,
  movement_type,
  business_date,
  amount,
  details,
  metadata,
  recorded_at
)
select
  summary.store_key,
  'daily_sales_summaries',
  summary.id,
  'cash_sale',
  summary.business_date,
  round(summary.cash_sales::numeric, 2),
  case
    when coalesce(summary.line_count, 0) > 0
      then concat(summary.line_count, ' sales lines logged as cash')
    else 'Cash sales recorded'
  end,
  jsonb_build_object(
    'cashSales', summary.cash_sales,
    'lineCount', coalesce(summary.line_count, 0),
    'reconciled', summary.reconciled
  ),
  coalesce(summary.updated_at, summary.created_at, timezone('utc', now()))
from public.daily_sales_summaries as summary
where coalesce(summary.cash_sales, 0) > 0;

insert into public.cash_vault_transactions (
  store_key,
  source_table,
  source_id,
  movement_type,
  business_date,
  amount,
  details,
  metadata,
  recorded_at
)
select
  reconciliation.store_key,
  'daily_sales_reconciliations',
  reconciliation.id,
  'sales_payout',
  reconciliation.reconciliation_date,
  round((reconciliation.total_payouts * -1)::numeric, 2),
  coalesce(
    nullif(btrim(reconciliation.notes), ''),
    'Sales payout recorded during closeout'
  ),
  jsonb_build_object(
    'status', reconciliation.status,
    'totalPayouts', reconciliation.total_payouts,
    'variance', reconciliation.variance
  ),
  coalesce(
    reconciliation.reconciled_at,
    reconciliation.updated_at,
    reconciliation.created_at,
    timezone('utc', now())
  )
from public.daily_sales_reconciliations as reconciliation
where reconciliation.status = 'approved'
  and coalesce(reconciliation.total_payouts, 0) > 0;

insert into public.cash_vault_transactions (
  store_key,
  source_table,
  source_id,
  movement_type,
  business_date,
  amount,
  details,
  metadata,
  recorded_at
)
select
  expense.store_key,
  'expense_records',
  expense.id,
  'cash_expense',
  expense.expense_date,
  round((expense.amount * -1)::numeric, 2),
  concat_ws(
    ': ',
    nullif(btrim(expense.category), ''),
    nullif(btrim(expense.description), '')
  ),
  jsonb_build_object(
    'category', expense.category,
    'paymentMethod', expense.payment_method,
    'status', expense.status,
    'vendorName', expense.vendor_name
  ),
  coalesce(expense.approved_at, expense.updated_at, expense.created_at, timezone('utc', now()))
from public.expense_records as expense
where expense.status = 'approved'
  and lower(coalesce(expense.payment_method, '')) = 'cash'
  and coalesce(expense.amount, 0) > 0;

insert into public.cash_vault_transactions (
  store_key,
  source_table,
  source_id,
  movement_type,
  business_date,
  amount,
  details,
  metadata,
  recorded_at
)
select
  payment.store_key,
  'vendor_payments',
  payment.id,
  'vendor_payment_cash',
  payment.payment_date,
  round((payment.amount_paid * -1)::numeric, 2),
  concat_ws(
    ' · ',
    coalesce(nullif(btrim(supplier.name), ''), 'Vendor payment'),
    nullif(btrim(payment.reference_number), '')
  ),
  jsonb_build_object(
    'supplierId', payment.supplier_id,
    'invoiceId', payment.vendor_invoice_id,
    'referenceNumber', payment.reference_number,
    'paymentMethod', payment.payment_method,
    'status', payment.status
  ),
  coalesce(payment.approved_at, payment.updated_at, payment.created_at, timezone('utc', now()))
from public.vendor_payments as payment
left join public.suppliers as supplier
  on supplier.id = payment.supplier_id
where payment.status = 'posted'
  and lower(coalesce(payment.payment_method, '')) = 'cash'
  and coalesce(payment.amount_paid, 0) > 0;

insert into public.cash_vault_transactions (
  store_key,
  source_table,
  source_id,
  movement_type,
  business_date,
  amount,
  details,
  metadata,
  recorded_at
)
select
  statement.store_key,
  'pay_statements',
  statement.id,
  'payroll_cash',
  statement.pay_date,
  round((statement.net_pay * -1)::numeric, 2),
  concat_ws(
    ' · ',
    coalesce(
      nullif(btrim(profile.full_name), ''),
      nullif(btrim(profile.email), ''),
      'Payroll'
    ),
    nullif(btrim(statement.period_label), '')
  ),
  jsonb_build_object(
    'employeeId', statement.employee_id,
    'periodLabel', statement.period_label,
    'paymentMethod', statement.payment_method,
    'status', statement.status
  ),
  coalesce(statement.updated_at, statement.created_at, timezone('utc', now()))
from public.pay_statements as statement
left join public.profiles as profile
  on profile.id = statement.employee_id
where statement.status = 'paid'
  and lower(coalesce(statement.payment_method, '')) = 'cash'
  and coalesce(statement.net_pay, 0) > 0;

insert into public.cash_vault_transactions (
  store_key,
  source_table,
  source_id,
  movement_type,
  business_date,
  amount,
  details,
  metadata,
  recorded_at
)
select
  deposit.store_key,
  'bank_deposits',
  deposit.id,
  'bank_deposit',
  deposit.deposit_date,
  round((deposit.amount * -1)::numeric, 2),
  coalesce(nullif(btrim(deposit.notes), ''), 'Deposit posted to bank'),
  jsonb_build_object(
    'createdBy', deposit.created_by,
    'slipPhotoUrl', deposit.slip_photo_url
  ),
  coalesce(deposit.updated_at, deposit.created_at, timezone('utc', now()))
from public.bank_deposits as deposit
where coalesce(deposit.amount, 0) > 0;
