-- Migration: lottery cash advance cash vault sync
-- Description: Allow lottery cash advances to transfer physical cash into Cash Vault.

alter table public.lottery_cash_advances
  add column if not exists send_to_cash_vault boolean not null default false;

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
      'bank_deposit',
      'opening_balance',
      'manual_adjustment',
      'lottery_cash_advance_to_vault',
      'lottery_cash_advance_payback_from_vault'
    )
  );

create or replace function public.sync_cash_vault_from_lottery_cash_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'lottery_cash_advances',
      old.id,
      'lottery_cash_advance_to_vault'
    );
    return old;
  end if;

  if coalesce(new.status, 'posted') = 'posted'
    and coalesce(new.send_to_cash_vault, false)
    and coalesce(new.amount, 0) > 0
  then
    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'lottery_cash_advances',
      new.id,
      'lottery_cash_advance_to_vault',
      new.advance_date,
      new.amount,
      concat_ws(
        ': ',
        'Lottery cash moved to vault',
        nullif(btrim(new.person_name), ''),
        nullif(btrim(new.reason), '')
      ),
      coalesce(new.updated_at, new.created_at, timezone('utc', now())),
      jsonb_build_object(
        'advanceDate', new.advance_date,
        'createdBy', new.created_by,
        'personName', new.person_name,
        'reason', new.reason,
        'status', new.status
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'lottery_cash_advances',
      new.id,
      'lottery_cash_advance_to_vault'
    );
  end if;

  return new;
end;
$$;

create or replace function public.sync_cash_vault_from_lottery_cash_advance_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  advance_row public.lottery_cash_advances%rowtype;
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'lottery_cash_advance_payments',
      old.id,
      'lottery_cash_advance_payback_from_vault'
    );
    return old;
  end if;

  select *
  into advance_row
  from public.lottery_cash_advances
  where id = new.advance_id
    and store_key = new.store_key;

  if coalesce(new.status, 'posted') = 'posted'
    and coalesce(new.amount, 0) > 0
    and coalesce(advance_row.status, 'void') = 'posted'
    and coalesce(advance_row.send_to_cash_vault, false)
  then
    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'lottery_cash_advance_payments',
      new.id,
      'lottery_cash_advance_payback_from_vault',
      new.payment_date,
      new.amount * -1,
      concat_ws(
        ': ',
        'Lottery cash returned from vault',
        nullif(btrim(advance_row.person_name), ''),
        nullif(btrim(new.notes), '')
      ),
      coalesce(new.updated_at, new.created_at, timezone('utc', now())),
      jsonb_build_object(
        'advanceId', new.advance_id,
        'createdBy', new.created_by,
        'paymentDate', new.payment_date,
        'personName', advance_row.person_name,
        'status', new.status
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'lottery_cash_advance_payments',
      new.id,
      'lottery_cash_advance_payback_from_vault'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists lottery_cash_advances_sync_cash_vault on public.lottery_cash_advances;
create trigger lottery_cash_advances_sync_cash_vault
after insert or update or delete on public.lottery_cash_advances
for each row
execute function public.sync_cash_vault_from_lottery_cash_advance();

drop trigger if exists lottery_cash_advance_payments_sync_cash_vault on public.lottery_cash_advance_payments;
create trigger lottery_cash_advance_payments_sync_cash_vault
after insert or update or delete on public.lottery_cash_advance_payments
for each row
execute function public.sync_cash_vault_from_lottery_cash_advance_payment();

delete from public.cash_vault_transactions
where source_table in (
  'lottery_cash_advances',
  'lottery_cash_advance_payments'
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
  advance.store_key,
  'lottery_cash_advances',
  advance.id,
  'lottery_cash_advance_to_vault',
  advance.advance_date,
  round(advance.amount::numeric, 2),
  concat_ws(
    ': ',
    'Lottery cash moved to vault',
    nullif(btrim(advance.person_name), ''),
    nullif(btrim(advance.reason), '')
  ),
  jsonb_build_object(
    'advanceDate', advance.advance_date,
    'createdBy', advance.created_by,
    'personName', advance.person_name,
    'reason', advance.reason,
    'status', advance.status
  ),
  coalesce(advance.updated_at, advance.created_at, timezone('utc', now()))
from public.lottery_cash_advances as advance
where coalesce(advance.status, 'posted') = 'posted'
  and coalesce(advance.send_to_cash_vault, false)
  and coalesce(advance.amount, 0) > 0;

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
  'lottery_cash_advance_payments',
  payment.id,
  'lottery_cash_advance_payback_from_vault',
  payment.payment_date,
  round((payment.amount * -1)::numeric, 2),
  concat_ws(
    ': ',
    'Lottery cash returned from vault',
    nullif(btrim(advance.person_name), ''),
    nullif(btrim(payment.notes), '')
  ),
  jsonb_build_object(
    'advanceId', payment.advance_id,
    'createdBy', payment.created_by,
    'paymentDate', payment.payment_date,
    'personName', advance.person_name,
    'status', payment.status
  ),
  coalesce(payment.updated_at, payment.created_at, timezone('utc', now()))
from public.lottery_cash_advance_payments as payment
join public.lottery_cash_advances as advance
  on advance.id = payment.advance_id
  and advance.store_key = payment.store_key
where coalesce(payment.status, 'posted') = 'posted'
  and coalesce(payment.amount, 0) > 0
  and coalesce(advance.status, 'posted') = 'posted'
  and coalesce(advance.send_to_cash_vault, false);
