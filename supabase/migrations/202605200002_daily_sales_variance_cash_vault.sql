-- Migration: Daily sales cash variance cash vault movement
-- Description: Include approved daily closeout variance in derived cash vault balances.

alter table public.cash_vault_transactions
  drop constraint if exists cash_vault_transactions_movement_type_check;

alter table public.cash_vault_transactions
  add constraint cash_vault_transactions_movement_type_check
  check (
    movement_type in (
      'cash_sale',
      'sales_payout',
      'cash_variance',
      'cash_expense',
      'vendor_payment_cash',
      'payroll_cash',
      'bank_deposit'
    )
  );

create or replace function public.sync_cash_vault_from_sales_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  variance_amount numeric;
  movement_recorded_at timestamptz;
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'daily_sales_reconciliations',
      old.id,
      'sales_payout'
    );
    perform public.delete_cash_vault_transaction(
      'daily_sales_reconciliations',
      old.id,
      'cash_variance'
    );
    return old;
  end if;

  movement_recorded_at := coalesce(
    new.reconciled_at,
    new.updated_at,
    new.created_at,
    timezone('utc', now())
  );

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
      movement_recorded_at,
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

  variance_amount := round(coalesce(new.variance, 0)::numeric, 2);

  if new.status = 'approved' and variance_amount <> 0 then
    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'daily_sales_reconciliations',
      new.id,
      'cash_variance',
      new.reconciliation_date,
      variance_amount * -1,
      case
        when variance_amount > 0 then 'Daily sales cash shortage'
        else 'Daily sales cash overage'
      end,
      movement_recorded_at,
      jsonb_build_object(
        'status', new.status,
        'variance', new.variance,
        'totalExpected', new.total_expected,
        'totalActual', new.total_actual,
        'cashCounted', new.cash_counted,
        'openingFloat', new.opening_float,
        'closingFloat', new.closing_float
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'daily_sales_reconciliations',
      new.id,
      'cash_variance'
    );
  end if;

  return new;
end;
$$;

delete from public.cash_vault_transactions as vault_transaction
where vault_transaction.source_table = 'daily_sales_reconciliations'
  and vault_transaction.movement_type = 'cash_variance'
  and exists (
    select 1
    from public.daily_sales_reconciliations as reconciliation
    where reconciliation.id = vault_transaction.source_id
      and (
        reconciliation.status <> 'approved'
        or round(coalesce(reconciliation.variance, 0)::numeric, 2) = 0
      )
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
  reconciliation.store_key,
  'daily_sales_reconciliations',
  reconciliation.id,
  'cash_variance',
  reconciliation.reconciliation_date,
  round((reconciliation.variance * -1)::numeric, 2),
  case
    when reconciliation.variance > 0 then 'Daily sales cash shortage'
    else 'Daily sales cash overage'
  end,
  jsonb_build_object(
    'status', reconciliation.status,
    'variance', reconciliation.variance,
    'totalExpected', reconciliation.total_expected,
    'totalActual', reconciliation.total_actual,
    'cashCounted', reconciliation.cash_counted,
    'openingFloat', reconciliation.opening_float,
    'closingFloat', reconciliation.closing_float
  ),
  coalesce(
    reconciliation.reconciled_at,
    reconciliation.updated_at,
    reconciliation.created_at,
    timezone('utc', now())
  )
from public.daily_sales_reconciliations as reconciliation
where reconciliation.status = 'approved'
  and round(coalesce(reconciliation.variance, 0)::numeric, 2) <> 0
on conflict (source_table, source_id, movement_type)
do update set
  store_key = excluded.store_key,
  business_date = excluded.business_date,
  amount = excluded.amount,
  details = excluded.details,
  metadata = excluded.metadata,
  recorded_at = excluded.recorded_at,
  updated_at = timezone('utc', now());
