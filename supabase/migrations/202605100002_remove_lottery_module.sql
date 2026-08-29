-- Migration: remove lottery module
-- Description: Drop lottery tables/functions and remove lottery-specific cash-vault source tracking.

do $$
begin
  if to_regclass('public.lottery_transactions') is not null then
    drop trigger if exists lottery_transactions_sync_cash_vault on public.lottery_transactions;
  end if;
end;
$$;

drop function if exists public.sync_cash_vault_from_lottery_transaction();
drop function if exists public.receive_lottery_scratch_pack(text, text, text, integer, uuid);
drop function if exists public.load_lottery_scratch_bin(text, uuid, integer, uuid);

delete from public.audit_events
where entity_type like 'lottery_%'
   or action like 'lottery.%';

delete from public.cash_vault_transactions
where source_table = 'lottery_transactions'
   or movement_type in ('lottery_sale', 'lottery_payout');

drop table if exists public.lottery_daily_reports cascade;
drop table if exists public.lottery_online_reports cascade;
drop table if exists public.lottery_instant_payout_reports cascade;
drop table if exists public.lottery_bins cascade;
drop table if exists public.lottery_bin_audits cascade;
drop table if exists public.lottery_settlements cascade;
drop table if exists public.lottery_closeouts cascade;
drop table if exists public.lottery_transactions cascade;
drop table if exists public.lottery_packs cascade;
drop table if exists public.lottery_games cascade;
drop table if exists public.lottery_settings cascade;

with removed_permissions(permission) as (
  values
    ('view:lottery'),
    ('create:lottery'),
    ('manage:lottery'),
    ('closeout:lottery'),
    ('view:lottery_reports'),
    ('approve:lottery_payouts')
),
cleaned_profiles as (
  select
    profiles.id,
    array(
      select profile_permission.permission
      from unnest(profiles.permissions) as profile_permission(permission)
      where not exists (
        select 1
        from removed_permissions
        where removed_permissions.permission = profile_permission.permission
      )
    ) as permissions
  from public.profiles as profiles
  where profiles.permissions && (
    select array_agg(permission)::text[]
    from removed_permissions
  )
)
update public.profiles as profiles
set permissions = cleaned_profiles.permissions,
    updated_at = timezone('utc', now())
from cleaned_profiles
where profiles.id = cleaned_profiles.id;

drop index if exists public.cash_vault_transactions_store_key_source_recorded_at_idx;

alter table public.bank_deposits
  drop constraint if exists bank_deposits_cash_source_check;

alter table public.bank_deposits
  drop column if exists cash_source;

alter table public.cash_vault_transactions
  drop constraint if exists cash_vault_transactions_cash_source_check;

alter table public.cash_vault_transactions
  drop column if exists cash_source;

alter table public.cash_vault_transactions
  drop constraint if exists cash_vault_transactions_movement_type_check;

alter table public.cash_vault_transactions
  add constraint cash_vault_transactions_movement_type_check
  check (
    movement_type in (
      'cash_sale',
      'sales_payout',
      'cash_expense',
      'vendor_payment_cash',
      'payroll_cash',
      'bank_deposit'
    )
  );

drop function if exists public.upsert_cash_vault_transaction(
  text,
  text,
  uuid,
  text,
  date,
  numeric,
  text,
  timestamptz,
  jsonb,
  text
);

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
