alter table public.daily_audits
  add column if not exists audit_type text not null default 'shift';

alter table public.inventory
  drop constraint if exists inventory_pack_number_key;

create unique index if not exists inventory_store_game_pack_number_unique_idx
on public.inventory (store_key, game_id, pack_number);

alter table public.daily_audits
  drop constraint if exists daily_audits_audit_type_valid;

alter table public.daily_audits
  add constraint daily_audits_audit_type_valid check (
    audit_type in ('opening', 'shift', 'eod', 'bin_load_retirement')
  );

alter table public.eod_reconciliation
  drop column if exists short_over_amount;

alter table public.eod_reconciliation
  add column short_over_amount numeric(12, 2) generated always as (
    total_expected_cash - pos_register_total
  ) stored;

create table if not exists public.daily_audit_revisions (
  revision_id uuid primary key default gen_random_uuid(),
  revision_operation text not null check (revision_operation in ('UPDATE', 'DELETE')),
  revised_at timestamptz not null default timezone('utc', now()),
  revised_by uuid references public.profiles (id) on delete set null,
  audit_id uuid,
  store_key text not null,
  audit_date date not null,
  employee_id uuid,
  inventory_id uuid,
  bin_number integer not null,
  start_ticket_no text not null,
  end_ticket_no text not null,
  tickets_sold integer not null,
  calculated_revenue numeric(12, 2) not null,
  audit_type text,
  original_created_at timestamptz,
  original_updated_at timestamptz
);

create table if not exists public.terminal_report_revisions (
  revision_id uuid primary key default gen_random_uuid(),
  revision_operation text not null check (revision_operation in ('UPDATE', 'DELETE')),
  revised_at timestamptz not null default timezone('utc', now()),
  revised_by uuid references public.profiles (id) on delete set null,
  terminal_report_id uuid,
  store_key text not null,
  report_date date not null,
  draw_sales numeric(12, 2) not null,
  draw_payouts numeric(12, 2) not null,
  scratch_payouts numeric(12, 2) not null,
  total_cashing_bonus numeric(12, 2) not null,
  total_cancels numeric(12, 2) not null,
  created_by uuid,
  original_created_at timestamptz,
  original_updated_at timestamptz
);

create table if not exists public.eod_reconciliation_revisions (
  revision_id uuid primary key default gen_random_uuid(),
  revision_operation text not null check (revision_operation in ('UPDATE', 'DELETE')),
  revised_at timestamptz not null default timezone('utc', now()),
  revised_by uuid references public.profiles (id) on delete set null,
  reconciliation_id uuid,
  store_key text not null,
  report_date date not null,
  total_expected_cash numeric(12, 2) not null,
  pos_register_total numeric(12, 2) not null,
  short_over_amount numeric(12, 2) not null,
  manager_notes text,
  created_by uuid,
  original_created_at timestamptz,
  original_updated_at timestamptz
);

create index if not exists daily_audit_revisions_store_date_idx
on public.daily_audit_revisions (store_key, audit_date desc, revised_at desc);

create index if not exists terminal_report_revisions_store_date_idx
on public.terminal_report_revisions (store_key, report_date desc, revised_at desc);

create index if not exists eod_reconciliation_revisions_store_date_idx
on public.eod_reconciliation_revisions (store_key, report_date desc, revised_at desc);

alter table public.daily_audit_revisions enable row level security;
alter table public.terminal_report_revisions enable row level security;
alter table public.eod_reconciliation_revisions enable row level security;

drop policy if exists "daily_audit_revisions_select_management"
on public.daily_audit_revisions;
create policy "daily_audit_revisions_select_management"
on public.daily_audit_revisions
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "terminal_report_revisions_select_management"
on public.terminal_report_revisions;
create policy "terminal_report_revisions_select_management"
on public.terminal_report_revisions
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "eod_reconciliation_revisions_select_management"
on public.eod_reconciliation_revisions;
create policy "eod_reconciliation_revisions_select_management"
on public.eod_reconciliation_revisions
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

create or replace function public.capture_daily_audit_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.daily_audit_revisions (
    revision_operation,
    revised_by,
    audit_id,
    store_key,
    audit_date,
    employee_id,
    inventory_id,
    bin_number,
    start_ticket_no,
    end_ticket_no,
    tickets_sold,
    calculated_revenue,
    audit_type,
    original_created_at,
    original_updated_at
  )
  values (
    tg_op,
    auth.uid(),
    old.audit_id,
    old.store_key,
    old.audit_date,
    old.employee_id,
    old.inventory_id,
    old.bin_number,
    old.start_ticket_no,
    old.end_ticket_no,
    old.tickets_sold,
    old.calculated_revenue,
    old.audit_type,
    old.created_at,
    old.updated_at
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function public.capture_terminal_report_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.terminal_report_revisions (
    revision_operation,
    revised_by,
    terminal_report_id,
    store_key,
    report_date,
    draw_sales,
    draw_payouts,
    scratch_payouts,
    total_cashing_bonus,
    total_cancels,
    created_by,
    original_created_at,
    original_updated_at
  )
  values (
    tg_op,
    auth.uid(),
    old.id,
    old.store_key,
    old.report_date,
    old.draw_sales,
    old.draw_payouts,
    old.scratch_payouts,
    old.total_cashing_bonus,
    old.total_cancels,
    old.created_by,
    old.created_at,
    old.updated_at
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function public.capture_eod_reconciliation_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.eod_reconciliation_revisions (
    revision_operation,
    revised_by,
    reconciliation_id,
    store_key,
    report_date,
    total_expected_cash,
    pos_register_total,
    short_over_amount,
    manager_notes,
    created_by,
    original_created_at,
    original_updated_at
  )
  values (
    tg_op,
    auth.uid(),
    old.id,
    old.store_key,
    old.report_date,
    old.total_expected_cash,
    old.pos_register_total,
    old.short_over_amount,
    old.manager_notes,
    old.created_by,
    old.created_at,
    old.updated_at
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists daily_audits_capture_revision
on public.daily_audits;
create trigger daily_audits_capture_revision
before update or delete on public.daily_audits
for each row
execute function public.capture_daily_audit_revision();

drop trigger if exists terminal_reports_capture_revision
on public.terminal_reports;
create trigger terminal_reports_capture_revision
before update or delete on public.terminal_reports
for each row
execute function public.capture_terminal_report_revision();

drop trigger if exists eod_reconciliation_capture_revision
on public.eod_reconciliation;
create trigger eod_reconciliation_capture_revision
before update or delete on public.eod_reconciliation
for each row
execute function public.capture_eod_reconciliation_revision();

drop policy if exists "terminal_reports_manage_operations" on public.terminal_reports;
create policy "terminal_reports_manage_operations"
on public.terminal_reports
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier'])));

create or replace function public.reconciliation_engine(
  target_store_key text,
  target_report_date date default ((timezone('utc', now()))::date),
  input_pos_register_total numeric default null,
  input_manager_notes text default null,
  reconciled_by uuid default auth.uid()
)
returns table (
  report_date date,
  scratch_sales numeric(12, 2),
  draw_sales numeric(12, 2),
  draw_payouts numeric(12, 2),
  scratch_payouts numeric(12, 2),
  total_expected_cash numeric(12, 2),
  pos_register_total numeric(12, 2),
  discrepancy numeric(12, 2)
)
language plpgsql
security definer
set search_path = public
as $$
declare
  scratch_sales_total numeric(12, 2);
  draw_sales_total numeric(12, 2);
  draw_payouts_total numeric(12, 2);
  scratch_payouts_total numeric(12, 2);
  cashing_bonus_total numeric(12, 2);
  ticket_cancels_total numeric(12, 2);
  expected_cash_total numeric(12, 2);
  pos_total numeric(12, 2);
begin
  if auth.uid() is not null
    and not (
      select public.can_access_store(
        target_store_key,
        array['admin', 'manager', 'accountant', 'cashier']
      )
    )
  then
    raise exception 'Forbidden: lottery reconciliation is not available for this store'
      using errcode = '42501';
  end if;

  if target_report_date is null then
    raise exception 'Report date is required'
      using errcode = '22023';
  end if;

  if input_pos_register_total is not null and input_pos_register_total < 0 then
    raise exception 'POS register total must be zero or greater'
      using errcode = '22023';
  end if;

  select coalesce(sum(daily_audit.calculated_revenue), 0)::numeric(12, 2)
  into scratch_sales_total
  from public.daily_audits daily_audit
  where daily_audit.store_key = target_store_key
    and daily_audit.audit_date = target_report_date;

  select
    coalesce(sum(terminal_report.draw_sales), 0)::numeric(12, 2),
    coalesce(sum(terminal_report.draw_payouts), 0)::numeric(12, 2),
    coalesce(sum(terminal_report.scratch_payouts), 0)::numeric(12, 2),
    coalesce(sum(terminal_report.total_cashing_bonus), 0)::numeric(12, 2),
    coalesce(sum(terminal_report.total_cancels), 0)::numeric(12, 2)
  into
    draw_sales_total,
    draw_payouts_total,
    scratch_payouts_total,
    cashing_bonus_total,
    ticket_cancels_total
  from public.terminal_reports terminal_report
  where terminal_report.store_key = target_store_key
    and terminal_report.report_date = target_report_date;

  expected_cash_total := round(
    (
      scratch_sales_total
      + draw_sales_total
      - draw_payouts_total
      - scratch_payouts_total
      - cashing_bonus_total
      - ticket_cancels_total
    )::numeric,
    2
  );

  if input_pos_register_total is null then
    select coalesce(reconciliation.pos_register_total, 0)
    into pos_total
    from public.eod_reconciliation reconciliation
    where reconciliation.store_key = target_store_key
      and reconciliation.report_date = target_report_date;

    pos_total := coalesce(pos_total, 0);
  else
    pos_total := round(input_pos_register_total, 2);
  end if;

  insert into public.eod_reconciliation (
    store_key,
    report_date,
    total_expected_cash,
    pos_register_total,
    manager_notes,
    created_by
  )
  values (
    target_store_key,
    target_report_date,
    expected_cash_total,
    pos_total,
    input_manager_notes,
    reconciled_by
  )
  on conflict (store_key, report_date) do update
  set
    total_expected_cash = excluded.total_expected_cash,
    pos_register_total = excluded.pos_register_total,
    manager_notes = coalesce(
      excluded.manager_notes,
      public.eod_reconciliation.manager_notes
    ),
    created_by = coalesce(
      excluded.created_by,
      public.eod_reconciliation.created_by
    ),
    updated_at = timezone('utc', now());

  return query
  select
    target_report_date,
    scratch_sales_total,
    draw_sales_total,
    draw_payouts_total,
    scratch_payouts_total,
    expected_cash_total,
    pos_total,
    (expected_cash_total - pos_total)::numeric(12, 2);
end;
$$;

drop function if exists public.load_scratch_pack_bin(text, text, integer);
drop function if exists public.load_scratch_pack_bin(text, text, integer, uuid, text, date, uuid);

create or replace function public.load_scratch_pack_bin(
  target_store_key text,
  target_pack_number text default null,
  target_bin_number integer default null,
  target_inventory_id uuid default null,
  input_retired_end_ticket_number text default null,
  target_report_date date default ((timezone('utc', now()))::date),
  loaded_by uuid default auth.uid()
)
returns table (
  loaded_inventory_id uuid,
  loaded_pack_number text,
  loaded_game_id text,
  loaded_bin_number integer,
  retired_inventory_id uuid,
  retired_pack_number text,
  retired_start_ticket_number text,
  retired_end_ticket_number text,
  retired_tickets_sold integer,
  retired_sales numeric(12, 2)
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_pack_number text;
  normalized_retired_end_ticket text;
  retired_end_value integer;
  retired_pack public.inventory%rowtype;
  retired_ticket_price numeric(10, 2);
  retired_start_ticket text;
  retired_start_value integer;
  retired_ticket_count integer;
  retired_sales_total numeric(12, 2);
  target_pack public.inventory%rowtype;
begin
  if loaded_by is null then
    raise exception 'An authenticated manager is required to load scratch bins'
      using errcode = '42501';
  end if;

  if not (select public.can_access_store(target_store_key, array['admin', 'manager'])) then
    raise exception 'Forbidden: loading scratch bins requires admin or manager access'
      using errcode = '42501';
  end if;

  normalized_pack_number := nullif(trim(coalesce(target_pack_number, '')), '');

  if target_inventory_id is null and normalized_pack_number is null then
    raise exception 'Pack inventory id or pack number is required'
      using errcode = '22023';
  end if;

  if normalized_pack_number is not null and normalized_pack_number !~ '^[0-9]{6}$' then
    raise exception 'Pack number must be 6 digits'
      using errcode = '22023';
  end if;

  if target_bin_number is null or target_bin_number <= 0 then
    raise exception 'Bin number must be a positive integer'
      using errcode = '22023';
  end if;

  if target_report_date is null then
    raise exception 'Report date is required'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_store_key), target_bin_number);

  if target_inventory_id is not null then
    select inventory_row.*
    into target_pack
    from public.inventory inventory_row
    where inventory_row.store_key = target_store_key
      and inventory_row.id = target_inventory_id
    for update;
  else
    select inventory_row.*
    into target_pack
    from public.inventory inventory_row
    where inventory_row.store_key = target_store_key
      and inventory_row.pack_number = normalized_pack_number
      and inventory_row.status = 'backstock'
    order by inventory_row.date_received desc, inventory_row.created_at desc
    limit 1
    for update;
  end if;

  if target_pack.id is null then
    raise exception 'Pack was not found in backstock'
      using errcode = 'P0002';
  end if;

  if target_pack.status <> 'backstock' then
    raise exception 'Pack % is %, not backstock', target_pack.pack_number, target_pack.status
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
    if trim(coalesce(input_retired_end_ticket_number, '')) !~ '^[0-9]{1,3}$' then
      raise exception 'Ending ticket number is required before replacing active bin %', target_bin_number
        using errcode = '22023';
    end if;

    normalized_retired_end_ticket := lpad(trim(input_retired_end_ticket_number)::integer::text, 3, '0');
    retired_end_value := normalized_retired_end_ticket::integer;

    select latest_audit.end_ticket_no
    into retired_start_ticket
    from public.daily_audits latest_audit
    where latest_audit.store_key = target_store_key
      and latest_audit.inventory_id = retired_pack.id
      and latest_audit.audit_date <= target_report_date
    order by latest_audit.audit_date desc, latest_audit.created_at desc
    limit 1;

    retired_start_ticket := coalesce(retired_start_ticket, '000');
    retired_start_value := retired_start_ticket::integer;

    if retired_end_value < retired_start_value then
      raise exception 'Ending ticket number for current pack in bin % cannot be lower than start ticket %',
        target_bin_number,
        retired_start_ticket
        using errcode = '22023';
    end if;

    select game.ticket_price
    into retired_ticket_price
    from public.game_catalog game
    where game.game_id = retired_pack.game_id;

    retired_ticket_count := retired_end_value - retired_start_value;
    retired_sales_total := round(
      (retired_ticket_count * coalesce(retired_ticket_price, 0))::numeric,
      2
    );

    insert into public.daily_audits (
      store_key,
      audit_date,
      employee_id,
      inventory_id,
      bin_number,
      start_ticket_no,
      end_ticket_no,
      tickets_sold,
      calculated_revenue,
      audit_type
    )
    values (
      target_store_key,
      target_report_date,
      loaded_by,
      retired_pack.id,
      target_bin_number,
      retired_start_ticket,
      normalized_retired_end_ticket,
      retired_ticket_count,
      retired_sales_total,
      'bin_load_retirement'
    );

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

  perform public.reconciliation_engine(
    target_store_key,
    target_report_date,
    null,
    null,
    null
  );

  return query
  select
    target_pack.id,
    target_pack.pack_number,
    target_pack.game_id,
    target_pack.bin_number,
    retired_pack.id,
    retired_pack.pack_number,
    retired_start_ticket,
    normalized_retired_end_ticket,
    retired_ticket_count,
    retired_sales_total;
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
  audit_record_id uuid;
  discrepancy_total numeric(12, 2);
  end_ticket_value integer;
  expected_start_ticket text;
  expected_sales_total numeric(12, 2);
  input_start_ticket text;
  normalized_end_ticket text;
  normalized_pos_sales numeric(12, 2);
  reset_allowed boolean;
  sold_ticket_count integer;
  start_ticket_value integer;
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

  input_start_ticket := lpad(trim(input_start_ticket_number)::integer::text, 3, '0');
  normalized_end_ticket := lpad(trim(input_end_ticket_number)::integer::text, 3, '0');
  normalized_pos_sales := round(input_pos_sales_amount, 2);

  select
    inventory_row.id as inventory_id,
    inventory_row.game_id,
    inventory_row.pack_number,
    inventory_row.bin_number,
    inventory_row.date_activated,
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

  select latest_audit.end_ticket_no
  into expected_start_ticket
  from public.daily_audits latest_audit
  where latest_audit.store_key = target_store_key
    and latest_audit.inventory_id = active_pack.inventory_id
  order by latest_audit.audit_date desc, latest_audit.created_at desc
  limit 1;

  expected_start_ticket := coalesce(expected_start_ticket, '000');

  if input_start_ticket <> expected_start_ticket then
    raise exception 'Start ticket changed from % to %. Reload the bin before saving.',
      input_start_ticket,
      expected_start_ticket
      using errcode = '22023';
  end if;

  start_ticket_value := expected_start_ticket::integer;
  end_ticket_value := normalized_end_ticket::integer;
  reset_allowed := active_pack.date_activated is not null
    and not exists (
      select 1
      from public.daily_audits prior_audit
      where prior_audit.store_key = target_store_key
        and prior_audit.inventory_id = active_pack.inventory_id
        and (
          prior_audit.tickets_sold > 0
          or prior_audit.calculated_revenue > 0
        )
    );

  if end_ticket_value < start_ticket_value then
    if not reset_allowed then
      raise exception 'End ticket number must be greater than or equal to start ticket number unless a new pack was activated'
        using errcode = '22023';
    end if;

    start_ticket_value := 0;
    expected_start_ticket := '000';
  end if;

  sold_ticket_count := end_ticket_value - start_ticket_value;
  expected_sales_total := round(
    (sold_ticket_count * active_pack.ticket_price)::numeric,
    2
  );
  discrepancy_total := expected_sales_total - normalized_pos_sales;

  insert into public.daily_audits (
    store_key,
    audit_date,
    employee_id,
    inventory_id,
    bin_number,
    start_ticket_no,
    end_ticket_no,
    tickets_sold,
    calculated_revenue,
    audit_type
  )
  values (
    target_store_key,
    (timezone('utc', now()))::date,
    reconciled_by,
    active_pack.inventory_id,
    target_bin_number,
    expected_start_ticket,
    normalized_end_ticket,
    sold_ticket_count,
    expected_sales_total,
    'shift'
  )
  returning public.daily_audits.audit_id
  into audit_record_id;

  perform public.reconciliation_engine(
    target_store_key,
    (timezone('utc', now()))::date,
    null,
    null,
    null
  );

  return query
  select
    audit_record_id,
    active_pack.inventory_id,
    active_pack.game_id,
    active_pack.pack_number,
    active_pack.bin_number,
    expected_start_ticket,
    normalized_end_ticket,
    active_pack.ticket_price,
    sold_ticket_count,
    expected_sales_total,
    normalized_pos_sales,
    discrepancy_total,
    case
      when discrepancy_total > 0 then 'short'
      when discrepancy_total < 0 then 'over'
      else 'balanced'
    end;
end;
$$;

drop function if exists public.save_lottery_eod_reconciliation(
  text,
  date,
  jsonb,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  text,
  uuid
);

drop function if exists public.save_lottery_eod_reconciliation(
  text,
  date,
  jsonb,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  text,
  uuid
);

create or replace function public.save_lottery_eod_reconciliation(
  target_store_key text,
  target_report_date date default ((timezone('utc', now()))::date),
  bin_entries jsonb default '[]'::jsonb,
  terminal_sales numeric default 0,
  ticket_cancels numeric default 0,
  online_total_payout numeric default 0,
  scratch_card_total_payout numeric default 0,
  cashing_bonus numeric default 0,
  till_cash numeric default 0,
  manager_notes text default null,
  reconciled_by uuid default auth.uid()
)
returns table (
  report_date date,
  bins_reconciled integer,
  scratch_sales numeric(12, 2),
  terminal_sales_total numeric(12, 2),
  ticket_cancels_total numeric(12, 2),
  online_payout_total numeric(12, 2),
  scratch_payout_total numeric(12, 2),
  cashing_bonus_total numeric(12, 2),
  total_expected_cash numeric(12, 2),
  till_cash_total numeric(12, 2),
  short_over_amount numeric(12, 2),
  discrepancy_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  active_bin_count integer;
  active_pack record;
  end_ticket_value integer;
  expected_cash_total numeric(12, 2);
  expected_sales_total numeric(12, 2);
  normalized_end_ticket text;
  normalized_start_ticket text;
  reconciled_bin_count integer := 0;
  reset_allowed boolean;
  scratch_sales_total numeric(12, 2) := 0;
  short_over_total numeric(12, 2);
  sold_ticket_count integer;
  start_ticket_value integer;
begin
  if reconciled_by is null then
    raise exception 'An authenticated employee is required for end-of-day reconciliation'
      using errcode = '42501';
  end if;

  if not (
    select public.can_access_store(
      target_store_key,
      array['admin', 'manager', 'accountant', 'cashier']
    )
  ) then
    raise exception 'Forbidden: lottery reconciliation is not available for this store'
      using errcode = '42501';
  end if;

  if target_report_date is null then
    raise exception 'Report date is required'
      using errcode = '22023';
  end if;

  if jsonb_typeof(bin_entries) <> 'array' then
    raise exception 'Bin entries must be a JSON array'
      using errcode = '22023';
  end if;

  if terminal_sales < 0
    or ticket_cancels < 0
    or online_total_payout < 0
    or scratch_card_total_payout < 0
    or cashing_bonus < 0
    or till_cash < 0
  then
    raise exception 'Lottery reconciliation amounts must be zero or greater'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(target_store_key),
    target_report_date - date '2000-01-01'
  );

  drop table if exists pg_temp.lottery_eod_bin_entries;
  create temporary table lottery_eod_bin_entries (
    bin_number integer primary key,
    end_ticket_no text not null
  ) on commit drop;

  insert into lottery_eod_bin_entries (bin_number, end_ticket_no)
  select
    entry.bin_number,
    trim(coalesce(entry.end_ticket_number, ''))
  from jsonb_to_recordset(bin_entries) as entry(
    bin_number integer,
    end_ticket_number text
  );

  if exists (
    select 1
    from lottery_eod_bin_entries entry
    where entry.bin_number is null
      or entry.bin_number <= 0
      or entry.end_ticket_no !~ '^[0-9]{1,3}$'
  ) then
    raise exception 'Each active bin needs a valid 1 to 3 digit ending ticket number'
      using errcode = '22023';
  end if;

  update lottery_eod_bin_entries
  set end_ticket_no = lpad(end_ticket_no::integer::text, 3, '0');

  select count(*)
  into active_bin_count
  from public.inventory inventory_row
  where inventory_row.store_key = target_store_key
    and inventory_row.status = 'active'
    and inventory_row.bin_number is not null;

  if active_bin_count > (
    select count(*)
    from lottery_eod_bin_entries
  ) then
    raise exception 'Enter ending ticket numbers for every active bin'
      using errcode = '22023';
  end if;

  for active_pack in
    select
      inventory_row.id as inventory_id,
      inventory_row.game_id,
      inventory_row.pack_number,
      inventory_row.bin_number,
      inventory_row.date_activated,
      game.ticket_price
    from public.inventory inventory_row
    join public.game_catalog game
      on game.game_id = inventory_row.game_id
    where inventory_row.store_key = target_store_key
      and inventory_row.status = 'active'
      and inventory_row.bin_number is not null
    order by inventory_row.bin_number
    for update of inventory_row
  loop
    normalized_end_ticket := null;
    select entry.end_ticket_no
    into normalized_end_ticket
    from lottery_eod_bin_entries entry
    where entry.bin_number = active_pack.bin_number;

    if normalized_end_ticket is null then
      raise exception 'Enter ending ticket number for bin %', active_pack.bin_number
        using errcode = '22023';
    end if;

    select latest_audit.end_ticket_no
    into normalized_start_ticket
    from public.daily_audits latest_audit
    where latest_audit.store_key = target_store_key
      and latest_audit.inventory_id = active_pack.inventory_id
      and latest_audit.audit_date <= target_report_date
    order by latest_audit.audit_date desc, latest_audit.created_at desc
    limit 1;

    normalized_start_ticket := coalesce(normalized_start_ticket, '000');
    start_ticket_value := normalized_start_ticket::integer;
    end_ticket_value := normalized_end_ticket::integer;

    reset_allowed := active_pack.date_activated is not null
      and not exists (
        select 1
        from public.daily_audits prior_audit
        where prior_audit.store_key = target_store_key
          and prior_audit.inventory_id = active_pack.inventory_id
          and (
            prior_audit.tickets_sold > 0
            or prior_audit.calculated_revenue > 0
          )
      );

    if end_ticket_value < start_ticket_value then
      if not reset_allowed then
        raise exception 'Ending ticket number for bin % cannot be lower than its starting ticket number unless a new pack was activated', active_pack.bin_number
          using errcode = '22023';
      end if;

      start_ticket_value := 0;
      normalized_start_ticket := '000';
    end if;

    sold_ticket_count := end_ticket_value - start_ticket_value;
    expected_sales_total := round(
      (sold_ticket_count * active_pack.ticket_price)::numeric,
      2
    );

    insert into public.daily_audits (
      store_key,
      audit_date,
      employee_id,
      inventory_id,
      bin_number,
      start_ticket_no,
      end_ticket_no,
      tickets_sold,
      calculated_revenue,
      audit_type
    )
    values (
      target_store_key,
      target_report_date,
      reconciled_by,
      active_pack.inventory_id,
      active_pack.bin_number,
      normalized_start_ticket,
      normalized_end_ticket,
      sold_ticket_count,
      expected_sales_total,
      'eod'
    );

    reconciled_bin_count := reconciled_bin_count + 1;
  end loop;

  select coalesce(sum(daily_audit.calculated_revenue), 0)::numeric(12, 2)
  into scratch_sales_total
  from public.daily_audits daily_audit
  where daily_audit.store_key = target_store_key
    and daily_audit.audit_date = target_report_date;

  expected_cash_total := round(
    (
      scratch_sales_total
      + terminal_sales
      - ticket_cancels
      - online_total_payout
      - scratch_card_total_payout
      - cashing_bonus
    )::numeric,
    2
  );
  short_over_total := round((expected_cash_total - till_cash)::numeric, 2);

  insert into public.terminal_reports (
    store_key,
    report_date,
    draw_sales,
    draw_payouts,
    scratch_payouts,
    total_cashing_bonus,
    total_cancels,
    created_by
  )
  values (
    target_store_key,
    target_report_date,
    round(terminal_sales, 2),
    round(online_total_payout, 2),
    round(scratch_card_total_payout, 2),
    round(cashing_bonus, 2),
    round(ticket_cancels, 2),
    reconciled_by
  )
  on conflict (store_key, report_date) do update
  set
    draw_sales = excluded.draw_sales,
    draw_payouts = excluded.draw_payouts,
    scratch_payouts = excluded.scratch_payouts,
    total_cashing_bonus = excluded.total_cashing_bonus,
    total_cancels = excluded.total_cancels,
    created_by = coalesce(excluded.created_by, public.terminal_reports.created_by),
    updated_at = timezone('utc', now());

  insert into public.eod_reconciliation (
    store_key,
    report_date,
    total_expected_cash,
    pos_register_total,
    manager_notes,
    created_by
  )
  values (
    target_store_key,
    target_report_date,
    expected_cash_total,
    round(till_cash, 2),
    nullif(trim(coalesce(manager_notes, '')), ''),
    reconciled_by
  )
  on conflict (store_key, report_date) do update
  set
    total_expected_cash = excluded.total_expected_cash,
    pos_register_total = excluded.pos_register_total,
    manager_notes = excluded.manager_notes,
    created_by = coalesce(excluded.created_by, public.eod_reconciliation.created_by),
    updated_at = timezone('utc', now());

  return query
  select
    target_report_date,
    reconciled_bin_count,
    scratch_sales_total::numeric(12, 2),
    round(terminal_sales, 2)::numeric(12, 2),
    round(ticket_cancels, 2)::numeric(12, 2),
    round(online_total_payout, 2)::numeric(12, 2),
    round(scratch_card_total_payout, 2)::numeric(12, 2),
    round(cashing_bonus, 2)::numeric(12, 2),
    expected_cash_total::numeric(12, 2),
    round(till_cash, 2)::numeric(12, 2),
    short_over_total::numeric(12, 2),
    case
      when short_over_total > 0 then 'short'
      when short_over_total < 0 then 'over'
      else 'balanced'
    end;
end;
$$;

revoke execute on function public.load_scratch_pack_bin(
  text,
  text,
  integer,
  uuid,
  text,
  date,
  uuid
) from public;
grant execute on function public.load_scratch_pack_bin(
  text,
  text,
  integer,
  uuid,
  text,
  date,
  uuid
) to authenticated;

revoke execute on function public.reconcile_scratch_bin(
  text,
  integer,
  text,
  text,
  numeric,
  uuid
) from public;
grant execute on function public.reconcile_scratch_bin(
  text,
  integer,
  text,
  text,
  numeric,
  uuid
) to authenticated;

revoke execute on function public.save_lottery_eod_reconciliation(
  text,
  date,
  jsonb,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  text,
  uuid
) from public;
grant execute on function public.save_lottery_eod_reconciliation(
  text,
  date,
  jsonb,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  text,
  uuid
) to authenticated;
