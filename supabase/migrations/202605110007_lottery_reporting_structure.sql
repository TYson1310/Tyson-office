do $$
begin
  if exists (
    select 1
    from pg_enum
    where enumtypid = 'public.scratch_pack_status'::regtype
      and enumlabel = 'in_backstock'
  )
  and not exists (
    select 1
    from pg_enum
    where enumtypid = 'public.scratch_pack_status'::regtype
      and enumlabel = 'backstock'
  ) then
    alter type public.scratch_pack_status rename value 'in_backstock' to 'backstock';
  end if;
end $$;

alter table public.inventory
  drop constraint if exists inventory_backstock_has_no_bin,
  drop constraint if exists inventory_active_requires_bin;

alter table public.inventory
  add constraint inventory_backstock_has_no_bin check (status <> 'backstock' or bin_number is null),
  add constraint inventory_active_requires_bin check (status <> 'active' or bin_number is not null);

alter table public.inventory
  add column if not exists pack_id text,
  add column if not exists date_received timestamptz,
  add column if not exists date_activated timestamptz;

update public.inventory
set
  pack_id = coalesce(pack_id, concat(game_id, '-', pack_number)),
  date_received = coalesce(date_received, created_at),
  date_activated = coalesce(
    date_activated,
    case
      when status in ('active', 'settled') then updated_at
      else null
    end
  );

alter table public.inventory
  alter column pack_id set not null,
  alter column date_received set default timezone('utc', now()),
  alter column date_received set not null;

create unique index if not exists inventory_pack_id_unique_idx
on public.inventory (pack_id);

create table if not exists public.daily_audits (
  audit_id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  audit_date date not null default ((timezone('utc', now()))::date),
  inventory_id uuid references public.inventory (id) on delete set null,
  employee_id uuid references public.profiles (id) on delete set null,
  bin_number integer not null,
  start_ticket_no text not null,
  end_ticket_no text not null,
  tickets_sold integer not null default 0,
  calculated_revenue numeric(12, 2) not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint daily_audits_bin_number_positive check (bin_number > 0),
  constraint daily_audits_start_ticket_format check (start_ticket_no ~ '^[0-9]{3}$'),
  constraint daily_audits_end_ticket_format check (end_ticket_no ~ '^[0-9]{3}$'),
  constraint daily_audits_tickets_sold_nonnegative check (tickets_sold >= 0),
  constraint daily_audits_calculated_revenue_nonnegative check (calculated_revenue >= 0)
);

create index if not exists daily_audits_store_date_idx
on public.daily_audits (store_key, audit_date desc);

create index if not exists daily_audits_inventory_id_idx
on public.daily_audits (inventory_id);

create index if not exists daily_audits_employee_id_idx
on public.daily_audits (employee_id);

drop trigger if exists daily_audits_set_updated_at on public.daily_audits;
create trigger daily_audits_set_updated_at
before update on public.daily_audits
for each row
execute function public.set_updated_at();

create table if not exists public.terminal_reports (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  report_date date not null,
  draw_sales numeric(12, 2) not null default 0,
  draw_payouts numeric(12, 2) not null default 0,
  scratch_payouts numeric(12, 2) not null default 0,
  total_cashing_bonus numeric(12, 2) not null default 0,
  total_cancels numeric(12, 2) not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint terminal_reports_amounts_nonnegative check (
    draw_sales >= 0
    and draw_payouts >= 0
    and scratch_payouts >= 0
    and total_cashing_bonus >= 0
    and total_cancels >= 0
  ),
  constraint terminal_reports_store_date_unique unique (store_key, report_date)
);

create index if not exists terminal_reports_store_date_idx
on public.terminal_reports (store_key, report_date desc);

drop trigger if exists terminal_reports_set_updated_at on public.terminal_reports;
create trigger terminal_reports_set_updated_at
before update on public.terminal_reports
for each row
execute function public.set_updated_at();

create table if not exists public.eod_reconciliation (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  report_date date not null,
  total_expected_cash numeric(12, 2) not null default 0,
  pos_register_total numeric(12, 2) not null default 0,
  short_over_amount numeric(12, 2) generated always as (
    pos_register_total - total_expected_cash
  ) stored,
  manager_notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint eod_reconciliation_amounts_nonnegative check (
    total_expected_cash >= 0
    and pos_register_total >= 0
  ),
  constraint eod_reconciliation_store_date_unique unique (store_key, report_date)
);

create index if not exists eod_reconciliation_store_date_idx
on public.eod_reconciliation (store_key, report_date desc);

drop trigger if exists eod_reconciliation_set_updated_at on public.eod_reconciliation;
create trigger eod_reconciliation_set_updated_at
before update on public.eod_reconciliation
for each row
execute function public.set_updated_at();

create or replace function public.recalculate_lottery_expected_cash(
  target_store_key text,
  target_report_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  scratch_revenue_total numeric(12, 2);
  terminal_cash_total numeric(12, 2);
begin
  if target_store_key is null or target_report_date is null then
    return;
  end if;

  select coalesce(sum(calculated_revenue), 0)::numeric(12, 2)
  into scratch_revenue_total
  from public.daily_audits
  where store_key = target_store_key
    and audit_date = target_report_date;

  select coalesce(
    sum(
      draw_sales
      - draw_payouts
      - scratch_payouts
      - total_cashing_bonus
      - total_cancels
    ),
    0
  )::numeric(12, 2)
  into terminal_cash_total
  from public.terminal_reports
  where store_key = target_store_key
    and report_date = target_report_date;

  insert into public.eod_reconciliation (
    store_key,
    report_date,
    total_expected_cash
  )
  values (
    target_store_key,
    target_report_date,
    greatest(scratch_revenue_total + terminal_cash_total, 0)
  )
  on conflict (store_key, report_date) do update
  set
    total_expected_cash = excluded.total_expected_cash,
    updated_at = timezone('utc', now());
end;
$$;

create or replace function public.sync_lottery_expected_cash_from_daily_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.recalculate_lottery_expected_cash(old.store_key, old.audit_date);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recalculate_lottery_expected_cash(new.store_key, new.audit_date);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists daily_audits_sync_lottery_expected_cash
on public.daily_audits;
create trigger daily_audits_sync_lottery_expected_cash
after insert or update or delete on public.daily_audits
for each row
execute function public.sync_lottery_expected_cash_from_daily_audit();

create or replace function public.sync_lottery_expected_cash_from_terminal_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.recalculate_lottery_expected_cash(old.store_key, old.report_date);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recalculate_lottery_expected_cash(new.store_key, new.report_date);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists terminal_reports_sync_lottery_expected_cash
on public.terminal_reports;
create trigger terminal_reports_sync_lottery_expected_cash
after insert or update or delete on public.terminal_reports
for each row
execute function public.sync_lottery_expected_cash_from_terminal_report();

alter table public.daily_audits enable row level security;
alter table public.terminal_reports enable row level security;
alter table public.eod_reconciliation enable row level security;

drop policy if exists "daily_audits_select_operations" on public.daily_audits;
create policy "daily_audits_select_operations"
on public.daily_audits
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

drop policy if exists "daily_audits_insert_operations" on public.daily_audits;
create policy "daily_audits_insert_operations"
on public.daily_audits
for insert
to authenticated
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'cashier', 'employee'])));

drop policy if exists "daily_audits_manage_management" on public.daily_audits;
create policy "daily_audits_manage_management"
on public.daily_audits
for update
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager'])));

drop policy if exists "daily_audits_delete_management" on public.daily_audits;
create policy "daily_audits_delete_management"
on public.daily_audits
for delete
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager'])));

drop policy if exists "terminal_reports_select_operations" on public.terminal_reports;
create policy "terminal_reports_select_operations"
on public.terminal_reports
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

drop policy if exists "terminal_reports_manage_operations" on public.terminal_reports;
create policy "terminal_reports_manage_operations"
on public.terminal_reports
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'cashier', 'employee'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'cashier', 'employee'])));

drop policy if exists "eod_reconciliation_select_operations" on public.eod_reconciliation;
create policy "eod_reconciliation_select_operations"
on public.eod_reconciliation
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier'])));

drop policy if exists "eod_reconciliation_manage_management" on public.eod_reconciliation;
create policy "eod_reconciliation_manage_management"
on public.eod_reconciliation
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

create or replace function public.receive_scratch_pack(
  target_store_key text,
  scanned_barcode text
)
returns table (
  id uuid,
  store_key text,
  pack_number text,
  game_id text,
  status public.scratch_pack_status,
  bin_number integer,
  ticket_number text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  barcode_matches text[];
  normalized_barcode text;
  parsed_game_id text;
  parsed_pack_number text;
  parsed_ticket_number text;
begin
  if not (
    select public.can_access_store(
      target_store_key,
      array['admin', 'manager', 'cashier', 'employee']
    )
  ) then
    raise exception 'Forbidden: receiving scratch packs is not available for this store'
      using errcode = '42501';
  end if;

  normalized_barcode := trim(coalesce(scanned_barcode, ''));
  barcode_matches := regexp_match(
    normalized_barcode,
    '^([0-9]{5})-([0-9]{6})-([0-9]{3})$'
  );

  if barcode_matches is null then
    raise exception 'Invalid barcode format. Expected GGGGG-PPPPPP-TTT'
      using errcode = '22023';
  end if;

  parsed_game_id := barcode_matches[1];
  parsed_pack_number := barcode_matches[2];
  parsed_ticket_number := barcode_matches[3];

  if not exists (
    select 1
    from public.game_catalog game
    where game.game_id = parsed_game_id
  ) then
    raise exception 'Game % was not found in game_catalog', parsed_game_id
      using errcode = 'P0002';
  end if;

  return query
  insert into public.inventory (
    pack_id,
    store_key,
    pack_number,
    game_id,
    status,
    bin_number,
    date_received
  )
  values (
    normalized_barcode,
    target_store_key,
    parsed_pack_number,
    parsed_game_id,
    'backstock',
    null,
    timezone('utc', now())
  )
  returning
    public.inventory.id,
    public.inventory.store_key,
    public.inventory.pack_number,
    public.inventory.game_id,
    public.inventory.status,
    public.inventory.bin_number,
    parsed_ticket_number,
    public.inventory.created_at;
exception
  when unique_violation then
    raise exception 'Pack % is already in inventory', parsed_pack_number
      using errcode = '23505';
end;
$$;

create or replace function public.load_scratch_pack_bin(
  target_store_key text,
  target_pack_number text,
  target_bin_number integer
)
returns table (
  loaded_inventory_id uuid,
  loaded_pack_number text,
  loaded_game_id text,
  loaded_bin_number integer,
  retired_inventory_id uuid,
  retired_pack_number text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_pack_number text;
  target_pack public.inventory%rowtype;
  retired_pack public.inventory%rowtype;
begin
  if not (select public.can_access_store(target_store_key, array['admin', 'manager'])) then
    raise exception 'Forbidden: loading scratch bins requires admin or manager access'
      using errcode = '42501';
  end if;

  normalized_pack_number := trim(coalesce(target_pack_number, ''));

  if normalized_pack_number !~ '^[0-9]{6}$' then
    raise exception 'Pack number must be 6 digits'
      using errcode = '22023';
  end if;

  if target_bin_number is null or target_bin_number <= 0 then
    raise exception 'Bin number must be a positive integer'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_store_key), target_bin_number);

  select inventory_row.*
  into target_pack
  from public.inventory inventory_row
  where inventory_row.store_key = target_store_key
    and inventory_row.pack_number = normalized_pack_number
  for update;

  if target_pack.id is null then
    raise exception 'Pack % was not found in backstock', normalized_pack_number
      using errcode = 'P0002';
  end if;

  if target_pack.status <> 'backstock' then
    raise exception 'Pack % is %, not backstock', normalized_pack_number, target_pack.status
      using errcode = '22023';
  end if;

  select inventory_row.*
  into retired_pack
  from public.inventory inventory_row
  where inventory_row.store_key = target_store_key
    and inventory_row.bin_number = target_bin_number
    and inventory_row.status = 'active'
    and inventory_row.id <> target_pack.id
  for update;

  if retired_pack.id is not null then
    update public.inventory
    set
      status = 'settled',
      bin_number = null
    where public.inventory.id = retired_pack.id;
  end if;

  update public.inventory
  set
    status = 'active',
    bin_number = target_bin_number,
    date_activated = timezone('utc', now())
  where public.inventory.id = target_pack.id
  returning public.inventory.*
  into target_pack;

  return query
  select
    target_pack.id,
    target_pack.pack_number,
    target_pack.game_id,
    target_pack.bin_number,
    retired_pack.id,
    retired_pack.pack_number;
end;
$$;

create or replace function public.reconcile_scratch_bin(
  target_store_key text,
  target_bin_number integer,
  input_start_ticket_number text,
  input_end_ticket_number text,
  input_pos_sales_amount numeric,
  reconciled_by uuid default auth.uid()
)
returns table (
  audit_id uuid,
  inventory_id uuid,
  game_id text,
  pack_number text,
  bin_number integer,
  start_ticket_number text,
  end_ticket_number text,
  ticket_price numeric(10, 2),
  tickets_sold integer,
  expected_sales numeric(12, 2),
  pos_sales_amount numeric(12, 2),
  short_over numeric(12, 2),
  discrepancy_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  active_pack record;
  start_ticket_value integer;
  end_ticket_value integer;
  normalized_start_ticket text;
  normalized_end_ticket text;
  normalized_pos_sales numeric(12, 2);
  sold_ticket_count integer;
  expected_sales_total numeric(12, 2);
  short_over_total numeric(12, 2);
  audit_record_id uuid;
begin
  if not (
    select public.can_access_store(
      target_store_key,
      array['admin', 'manager', 'cashier', 'employee']
    )
  ) then
    raise exception 'Forbidden: scratch reconciliation is not available for this store'
      using errcode = '42501';
  end if;

  if reconciled_by is null then
    raise exception 'An authenticated employee is required for reconciliation'
      using errcode = '42501';
  end if;

  if target_bin_number is null or target_bin_number <= 0 then
    raise exception 'Bin number must be a positive integer'
      using errcode = '22023';
  end if;

  if trim(coalesce(input_start_ticket_number, '')) !~ '^[0-9]{1,3}$' then
    raise exception 'Start ticket number must be 1 to 3 digits'
      using errcode = '22023';
  end if;

  if trim(coalesce(input_end_ticket_number, '')) !~ '^[0-9]{1,3}$' then
    raise exception 'End ticket number must be 1 to 3 digits'
      using errcode = '22023';
  end if;

  if input_pos_sales_amount is null or input_pos_sales_amount < 0 then
    raise exception 'POS sales amount must be zero or greater'
      using errcode = '22023';
  end if;

  start_ticket_value := trim(input_start_ticket_number)::integer;
  end_ticket_value := trim(input_end_ticket_number)::integer;
  normalized_start_ticket := lpad(start_ticket_value::text, 3, '0');
  normalized_end_ticket := lpad(end_ticket_value::text, 3, '0');
  normalized_pos_sales := round(input_pos_sales_amount, 2);

  select
    inventory_row.id as inventory_id,
    inventory_row.game_id,
    inventory_row.pack_number,
    inventory_row.bin_number,
    game.ticket_price
  into active_pack
  from public.inventory inventory_row
  join public.game_catalog game
    on game.game_id = inventory_row.game_id
  where inventory_row.store_key = target_store_key
    and inventory_row.bin_number = target_bin_number
    and inventory_row.status = 'active'
  for update of inventory_row;

  if active_pack.inventory_id is null then
    raise exception 'No active scratch pack was found in bin %', target_bin_number
      using errcode = 'P0002';
  end if;

  sold_ticket_count := abs(end_ticket_value - start_ticket_value);
  expected_sales_total := round(
    (sold_ticket_count * active_pack.ticket_price)::numeric,
    2
  );
  short_over_total := normalized_pos_sales - expected_sales_total;

  insert into public.daily_audits (
    store_key,
    audit_date,
    employee_id,
    inventory_id,
    bin_number,
    start_ticket_no,
    end_ticket_no,
    tickets_sold,
    calculated_revenue
  )
  values (
    target_store_key,
    (timezone('utc', now()))::date,
    reconciled_by,
    active_pack.inventory_id,
    target_bin_number,
    normalized_start_ticket,
    normalized_end_ticket,
    sold_ticket_count,
    expected_sales_total
  )
  returning public.daily_audits.audit_id
  into audit_record_id;

  return query
  select
    audit_record_id,
    active_pack.inventory_id,
    active_pack.game_id,
    active_pack.pack_number,
    active_pack.bin_number,
    normalized_start_ticket,
    normalized_end_ticket,
    active_pack.ticket_price,
    sold_ticket_count,
    expected_sales_total,
    normalized_pos_sales,
    short_over_total,
    case
      when short_over_total < 0 then 'short'
      when short_over_total > 0 then 'over'
      else 'balanced'
    end;
end;
$$;
