-- Migration: lottery operations foundation
-- Description: add lottery module tables, separate lottery till settings, and cash-source-aware vault tracking.

create table if not exists public.lottery_settings (
  store_key text primary key references public.stores (store_key) on delete cascade,
  till_opening_float numeric(12, 2) not null default 300,
  till_closing_float numeric(12, 2) not null default 300,
  allow_multiple_active_packs boolean not null default false,
  default_payout_threshold numeric(12, 2) not null default 600,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lottery_settings_till_opening_float_check check (till_opening_float >= 0),
  constraint lottery_settings_till_closing_float_check check (till_closing_float >= 0),
  constraint lottery_settings_default_payout_threshold_check check (default_payout_threshold >= 0)
);

drop trigger if exists lottery_settings_set_updated_at on public.lottery_settings;
create trigger lottery_settings_set_updated_at
before update on public.lottery_settings
for each row
execute function public.set_updated_at();

insert into public.lottery_settings (store_key)
select store_key
from public.stores
on conflict (store_key) do nothing;

alter table public.lottery_settings enable row level security;

drop policy if exists "lottery_settings_select_staff" on public.lottery_settings;
create policy "lottery_settings_select_staff"
on public.lottery_settings
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'cashier', 'employee'])));

drop policy if exists "lottery_settings_manage_management" on public.lottery_settings;
create policy "lottery_settings_manage_management"
on public.lottery_settings
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager'])));

create table if not exists public.lottery_games (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete cascade,
  provider text not null default 'State Lottery',
  game_code text not null,
  name text not null,
  game_type text not null default 'scratch' check (game_type in ('scratch', 'draw', 'fast_play', 'other')),
  ticket_price numeric(12, 2) not null default 0,
  commission_rate numeric(5, 2) not null default 0,
  payout_threshold numeric(12, 2),
  requires_pack_tracking boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lottery_games_ticket_price_check check (ticket_price >= 0),
  constraint lottery_games_commission_rate_check check (commission_rate >= 0 and commission_rate <= 100),
  constraint lottery_games_payout_threshold_check check (payout_threshold is null or payout_threshold >= 0),
  constraint lottery_games_store_code_unique unique (store_key, game_code)
);

drop trigger if exists lottery_games_set_updated_at on public.lottery_games;
create trigger lottery_games_set_updated_at
before update on public.lottery_games
for each row
execute function public.set_updated_at();

create index if not exists lottery_games_store_key_idx
  on public.lottery_games (store_key, is_active desc, sort_order asc, name asc);

alter table public.lottery_games enable row level security;

drop policy if exists "lottery_games_select_staff" on public.lottery_games;
create policy "lottery_games_select_staff"
on public.lottery_games
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'cashier', 'employee'])));

drop policy if exists "lottery_games_manage_management" on public.lottery_games;
create policy "lottery_games_manage_management"
on public.lottery_games
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager'])));

create table if not exists public.lottery_packs (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete cascade,
  lottery_game_id uuid not null references public.lottery_games (id) on delete cascade,
  pack_number text not null,
  start_ticket_number integer not null,
  end_ticket_number integer not null,
  ticket_count integer not null,
  status text not null default 'received' check (status in ('received', 'active', 'paused', 'closed', 'returned', 'settled')),
  received_date date not null default current_date,
  activated_at timestamptz,
  closed_at timestamptz,
  settled_at timestamptz,
  received_by uuid references public.profiles (id) on delete set null,
  activated_by uuid references public.profiles (id) on delete set null,
  closed_by uuid references public.profiles (id) on delete set null,
  settled_by uuid references public.profiles (id) on delete set null,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lottery_packs_ticket_range_check check (end_ticket_number >= start_ticket_number),
  constraint lottery_packs_ticket_count_check check (ticket_count > 0),
  constraint lottery_packs_store_game_pack_unique unique (store_key, lottery_game_id, pack_number)
);

drop trigger if exists lottery_packs_set_updated_at on public.lottery_packs;
create trigger lottery_packs_set_updated_at
before update on public.lottery_packs
for each row
execute function public.set_updated_at();

create index if not exists lottery_packs_store_key_status_idx
  on public.lottery_packs (store_key, status, received_date desc);

create index if not exists lottery_packs_game_id_idx
  on public.lottery_packs (lottery_game_id, status, created_at desc);

alter table public.lottery_packs enable row level security;

drop policy if exists "lottery_packs_select_staff" on public.lottery_packs;
create policy "lottery_packs_select_staff"
on public.lottery_packs
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'cashier', 'employee'])));

drop policy if exists "lottery_packs_manage_management" on public.lottery_packs;
create policy "lottery_packs_manage_management"
on public.lottery_packs
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager'])));

create table if not exists public.lottery_transactions (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete cascade,
  business_date date not null,
  lottery_game_id uuid not null references public.lottery_games (id) on delete restrict,
  lottery_pack_id uuid references public.lottery_packs (id) on delete set null,
  transaction_type text not null check (transaction_type in ('sale', 'payout', 'void', 'adjustment', 'reversal')),
  quantity integer not null default 1,
  cash_amount numeric(12, 2) not null default 0,
  starting_ticket_number integer,
  ending_ticket_number integer,
  employee_id uuid references public.profiles (id) on delete set null,
  reference_transaction_id uuid references public.lottery_transactions (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lottery_transactions_quantity_check check (quantity > 0),
  constraint lottery_transactions_cash_amount_check check (cash_amount >= 0),
  constraint lottery_transactions_ticket_range_check check (
    ending_ticket_number is null
    or starting_ticket_number is null
    or ending_ticket_number >= starting_ticket_number
  )
);

drop trigger if exists lottery_transactions_set_updated_at on public.lottery_transactions;
create trigger lottery_transactions_set_updated_at
before update on public.lottery_transactions
for each row
execute function public.set_updated_at();

create index if not exists lottery_transactions_store_key_date_idx
  on public.lottery_transactions (store_key, business_date desc, created_at desc);

create index if not exists lottery_transactions_game_id_idx
  on public.lottery_transactions (lottery_game_id, business_date desc, created_at desc);

create index if not exists lottery_transactions_pack_id_idx
  on public.lottery_transactions (lottery_pack_id, created_at desc);

alter table public.lottery_transactions enable row level security;

drop policy if exists "lottery_transactions_select_staff" on public.lottery_transactions;
create policy "lottery_transactions_select_staff"
on public.lottery_transactions
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'cashier', 'employee'])));

drop policy if exists "lottery_transactions_insert_staff" on public.lottery_transactions;
create policy "lottery_transactions_insert_staff"
on public.lottery_transactions
for insert
to authenticated
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'cashier', 'employee'])));

drop policy if exists "lottery_transactions_manage_management" on public.lottery_transactions;
create policy "lottery_transactions_manage_management"
on public.lottery_transactions
for update
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager'])));

create table if not exists public.lottery_closeouts (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete cascade,
  business_date date not null,
  opening_cash numeric(12, 2) not null default 0,
  closing_cash numeric(12, 2) not null default 0,
  cash_counted numeric(12, 2) not null default 0,
  total_sales numeric(12, 2) not null default 0,
  total_payouts numeric(12, 2) not null default 0,
  expected_cash numeric(12, 2) not null default 0,
  actual_cash numeric(12, 2) not null default 0,
  variance numeric(12, 2) not null default 0,
  variance_percent numeric(12, 2) not null default 0,
  notes text,
  status text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  closed_by uuid references public.profiles (id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lottery_closeouts_store_date_unique unique (store_key, business_date)
);

drop trigger if exists lottery_closeouts_set_updated_at on public.lottery_closeouts;
create trigger lottery_closeouts_set_updated_at
before update on public.lottery_closeouts
for each row
execute function public.set_updated_at();

create index if not exists lottery_closeouts_store_key_date_idx
  on public.lottery_closeouts (store_key, business_date desc);

alter table public.lottery_closeouts enable row level security;

drop policy if exists "lottery_closeouts_select_staff" on public.lottery_closeouts;
create policy "lottery_closeouts_select_staff"
on public.lottery_closeouts
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'cashier', 'employee'])));

drop policy if exists "lottery_closeouts_manage_management" on public.lottery_closeouts;
create policy "lottery_closeouts_manage_management"
on public.lottery_closeouts
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager'])));

create table if not exists public.lottery_settlements (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete cascade,
  period_start date not null,
  period_end date not null,
  statement_reference text,
  gross_sales numeric(12, 2) not null default 0,
  total_payouts numeric(12, 2) not null default 0,
  commission_earned numeric(12, 2) not null default 0,
  adjustments numeric(12, 2) not null default 0,
  net_due numeric(12, 2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'posted', 'paid')),
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lottery_settlements_period_check check (period_end >= period_start)
);

drop trigger if exists lottery_settlements_set_updated_at on public.lottery_settlements;
create trigger lottery_settlements_set_updated_at
before update on public.lottery_settlements
for each row
execute function public.set_updated_at();

create index if not exists lottery_settlements_store_key_period_idx
  on public.lottery_settlements (store_key, period_end desc, period_start desc);

alter table public.lottery_settlements enable row level security;

drop policy if exists "lottery_settlements_select_management" on public.lottery_settlements;
create policy "lottery_settlements_select_management"
on public.lottery_settlements
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager'])));

drop policy if exists "lottery_settlements_manage_management" on public.lottery_settlements;
create policy "lottery_settlements_manage_management"
on public.lottery_settlements
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager'])));

alter table public.bank_deposits
  add column if not exists cash_source text not null default 'store_till';

alter table public.bank_deposits
  drop constraint if exists bank_deposits_cash_source_check;

alter table public.bank_deposits
  add constraint bank_deposits_cash_source_check
  check (cash_source in ('store_till', 'lottery_till'));

alter table public.cash_vault_transactions
  add column if not exists cash_source text not null default 'store_till';

alter table public.cash_vault_transactions
  drop constraint if exists cash_vault_transactions_cash_source_check;

alter table public.cash_vault_transactions
  add constraint cash_vault_transactions_cash_source_check
  check (cash_source in ('store_till', 'lottery_till'));

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
      'bank_deposit',
      'lottery_sale',
      'lottery_payout'
    )
  );

create index if not exists cash_vault_transactions_store_key_source_recorded_at_idx
  on public.cash_vault_transactions (store_key, cash_source, recorded_at desc, business_date desc);

create or replace function public.upsert_cash_vault_transaction(
  p_store_key text,
  p_source_table text,
  p_source_id uuid,
  p_movement_type text,
  p_business_date date,
  p_amount numeric,
  p_details text,
  p_recorded_at timestamptz,
  p_metadata jsonb default '{}'::jsonb,
  p_cash_source text default 'store_till'
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
    cash_source,
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
    coalesce(nullif(btrim(p_cash_source), ''), 'store_till'),
    round(p_amount::numeric, 2),
    coalesce(nullif(btrim(p_details), ''), 'Cash movement logged'),
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_recorded_at, timezone('utc', now()))
  )
  on conflict (source_table, source_id, movement_type)
  do update set
    store_key = excluded.store_key,
    business_date = excluded.business_date,
    cash_source = excluded.cash_source,
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
        'slipPhotoUrl', new.slip_photo_url,
        'cashSource', new.cash_source
      ),
      new.cash_source
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

create or replace function public.sync_cash_vault_from_lottery_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_name text;
  v_movement_type text;
  v_signed_amount numeric;
  v_details text;
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'lottery_transactions',
      old.id,
      case
        when old.transaction_type = 'sale' then 'lottery_sale'
        else 'lottery_payout'
      end
    );
    return old;
  end if;

  if new.transaction_type not in ('sale', 'payout') or coalesce(new.cash_amount, 0) <= 0 then
    perform public.delete_cash_vault_transaction(
      'lottery_transactions',
      new.id,
      'lottery_sale'
    );
    perform public.delete_cash_vault_transaction(
      'lottery_transactions',
      new.id,
      'lottery_payout'
    );
    return new;
  end if;

  select name
  into v_game_name
  from public.lottery_games
  where id = new.lottery_game_id;

  v_movement_type := case
    when new.transaction_type = 'sale' then 'lottery_sale'
    else 'lottery_payout'
  end;
  v_signed_amount := case
    when new.transaction_type = 'sale' then new.cash_amount
    else new.cash_amount * -1
  end;
  v_details := case
    when new.transaction_type = 'sale'
      then concat_ws(' ', coalesce(nullif(btrim(v_game_name), ''), 'Lottery'), 'sale')
    else concat_ws(' ', coalesce(nullif(btrim(v_game_name), ''), 'Lottery'), 'payout')
  end;

  perform public.delete_cash_vault_transaction(
    'lottery_transactions',
    new.id,
    case
      when v_movement_type = 'lottery_sale' then 'lottery_payout'
      else 'lottery_sale'
    end
  );

  perform public.upsert_cash_vault_transaction(
    new.store_key,
    'lottery_transactions',
    new.id,
    v_movement_type,
    new.business_date,
    v_signed_amount,
    coalesce(nullif(btrim(new.notes), ''), v_details),
    coalesce(new.updated_at, new.created_at, timezone('utc', now())),
    jsonb_build_object(
      'lotteryGameId', new.lottery_game_id,
      'lotteryPackId', new.lottery_pack_id,
      'transactionType', new.transaction_type,
      'quantity', new.quantity,
      'employeeId', new.employee_id
    ),
    'lottery_till'
  );

  return new;
end;
$$;

drop trigger if exists lottery_transactions_sync_cash_vault on public.lottery_transactions;
create trigger lottery_transactions_sync_cash_vault
after insert or update or delete on public.lottery_transactions
for each row
execute function public.sync_cash_vault_from_lottery_transaction();

update public.bank_deposits
set cash_source = coalesce(cash_source, 'store_till')
where cash_source is null;

update public.cash_vault_transactions
set cash_source = coalesce(cash_source, 'store_till')
where cash_source is null;
