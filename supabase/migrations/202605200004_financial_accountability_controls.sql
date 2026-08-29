-- Migration: Financial accountability controls
-- Description: Add evidence, correction, opening-balance, and inventory adjustment controls.

alter table public.lottery_eft_weekly_status
  add column if not exists paid_reference text,
  add column if not exists paid_notes text;

alter table public.bank_deposits
  add column if not exists status text not null default 'posted',
  add column if not exists voided_by uuid references public.profiles (id) on delete set null,
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;

alter table public.bank_deposits
  drop constraint if exists bank_deposits_status_check;

alter table public.bank_deposits
  add constraint bank_deposits_status_check
  check (status in ('posted', 'void'));

update public.bank_deposits
set status = 'posted'
where status is null;

create index if not exists bank_deposits_store_status_date_idx
  on public.bank_deposits (store_key, status, deposit_date desc);

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
      'manual_adjustment'
    )
  );

alter table public.inventory_movements
  add column if not exists vendor_invoice_id uuid references public.vendor_invoices (id) on delete set null;

create index if not exists inventory_movements_store_invoice_created_idx
  on public.inventory_movements (store_key, vendor_invoice_id, created_at desc);

create table if not exists public.cash_vault_adjustments (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  adjustment_date date not null default current_date,
  adjustment_type text not null
    check (adjustment_type in ('opening_balance', 'manual_adjustment')),
  amount numeric(12, 2) not null check (amount <> 0),
  reason text not null check (length(btrim(reason)) > 0),
  reference_number text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists cash_vault_adjustments_store_date_idx
  on public.cash_vault_adjustments (store_key, adjustment_date desc, created_at desc);

alter table public.cash_vault_adjustments enable row level security;

drop policy if exists "cash_vault_adjustments_select_management" on public.cash_vault_adjustments;
create policy "cash_vault_adjustments_select_management"
on public.cash_vault_adjustments
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "cash_vault_adjustments_manage_management" on public.cash_vault_adjustments;
create policy "cash_vault_adjustments_manage_management"
on public.cash_vault_adjustments
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop trigger if exists cash_vault_adjustments_set_updated_at on public.cash_vault_adjustments;
create trigger cash_vault_adjustments_set_updated_at
before update on public.cash_vault_adjustments
for each row
execute function public.set_updated_at();

drop trigger if exists cash_vault_adjustments_accounting_period_lock on public.cash_vault_adjustments;
create trigger cash_vault_adjustments_accounting_period_lock
before insert or update or delete on public.cash_vault_adjustments
for each row execute function public.prevent_closed_accounting_period_changes('adjustment_date');

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

  if coalesce(new.status, 'posted') = 'posted' and coalesce(new.amount, 0) > 0 then
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
        'slipPhotoUrl', new.slip_photo_url,
        'status', new.status
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

create or replace function public.sync_cash_vault_from_cash_vault_adjustment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  movement_type text;
  detail_text text;
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'cash_vault_adjustments',
      old.id,
      case
        when old.adjustment_type = 'opening_balance' then 'opening_balance'
        else 'manual_adjustment'
      end
    );
    return old;
  end if;

  if tg_op = 'UPDATE' and old.adjustment_type <> new.adjustment_type then
    perform public.delete_cash_vault_transaction(
      'cash_vault_adjustments',
      old.id,
      case
        when old.adjustment_type = 'opening_balance' then 'opening_balance'
        else 'manual_adjustment'
      end
    );
  end if;

  movement_type := case
    when new.adjustment_type = 'opening_balance' then 'opening_balance'
    else 'manual_adjustment'
  end;
  detail_text := concat(
    case
      when new.adjustment_type = 'opening_balance' then 'Opening cash balance'
      else 'Cash vault adjustment'
    end,
    ': ',
    btrim(new.reason)
  );

  if nullif(btrim(coalesce(new.reference_number, '')), '') is not null then
    detail_text := concat(detail_text, ' (Ref ', btrim(new.reference_number), ')');
  end if;

  perform public.upsert_cash_vault_transaction(
    new.store_key,
    'cash_vault_adjustments',
    new.id,
    movement_type,
    new.adjustment_date,
    new.amount,
    detail_text,
    coalesce(new.updated_at, new.created_at, timezone('utc', now())),
    jsonb_build_object(
      'adjustmentType', new.adjustment_type,
      'createdBy', new.created_by,
      'reason', new.reason,
      'referenceNumber', new.reference_number
    )
  );

  return new;
end;
$$;

drop trigger if exists bank_deposits_sync_cash_vault on public.bank_deposits;
create trigger bank_deposits_sync_cash_vault
after insert or update or delete on public.bank_deposits
for each row
execute function public.sync_cash_vault_from_bank_deposit();

drop trigger if exists cash_vault_adjustments_sync_cash_vault on public.cash_vault_adjustments;
create trigger cash_vault_adjustments_sync_cash_vault
after insert or update or delete on public.cash_vault_adjustments
for each row
execute function public.sync_cash_vault_from_cash_vault_adjustment();

alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check
  check (
    movement_type in (
      'vendor_return',
      'vendor_return_reversal',
      'manual_adjustment',
      'vendor_invoice_receipt'
    )
  );
