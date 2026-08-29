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
    greatest(
      (
        scratch_sales_total
        + draw_sales_total
        - draw_payouts_total
        - scratch_payouts_total
        - cashing_bonus_total
        - ticket_cancels_total
      )::numeric,
      0
    ),
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
  on conflict on constraint eod_reconciliation_store_date_unique do update
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
  retired_ticket_limit integer;
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

    select
      game.ticket_price,
      coalesce(retired_pack.pack_ticket_count, game.ticket_count)
    into retired_ticket_price, retired_ticket_limit
    from public.game_catalog game
    where game.game_id = retired_pack.game_id;

    if retired_ticket_limit is not null
      and retired_ticket_limit > 0
      and retired_end_value > retired_ticket_limit
    then
      raise exception 'Ending ticket number for current pack in bin % cannot be greater than pack ticket count %',
        target_bin_number,
        retired_ticket_limit
        using errcode = '22023';
    end if;

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

drop function if exists public.reconcile_scratch_bin(
  text,
  integer,
  text,
  text,
  numeric,
  uuid
);

create or replace function public.reconcile_scratch_bin(
  target_store_key text,
  target_bin_number integer,
  input_start_ticket_number text,
  input_end_ticket_number text,
  input_pos_sales_amount numeric,
  target_report_date date default ((timezone('utc', now()))::date),
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
  ticket_limit integer;
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

  if target_report_date is null then
    raise exception 'Report date is required'
      using errcode = '22023';
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
    coalesce(inventory_row.pack_ticket_count, game.ticket_count) as ticket_limit,
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
    and latest_audit.audit_date <= target_report_date
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
  ticket_limit := active_pack.ticket_limit;

  if ticket_limit is not null
    and ticket_limit > 0
    and end_ticket_value > ticket_limit
  then
    raise exception 'End ticket number for bin % cannot be greater than pack ticket count %',
      target_bin_number,
      ticket_limit
      using errcode = '22023';
  end if;

  reset_allowed := active_pack.date_activated is not null
    and not exists (
      select 1
      from public.daily_audits prior_audit
      where prior_audit.store_key = target_store_key
        and prior_audit.inventory_id = active_pack.inventory_id
        and prior_audit.audit_date <= target_report_date
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
    target_report_date,
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
    target_report_date,
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
  audit_record_id uuid;
  bin_entry record;
  end_ticket_value integer;
  existing_eod_audit_id uuid;
  existing_eod_bin_count integer;
  expected_sales_total numeric(12, 2);
  expected_cash_total numeric(12, 2);
  normalized_end_ticket text;
  normalized_start_ticket text;
  reconciled_bin_count integer := 0;
  reset_allowed boolean;
  scratch_sales_total numeric(12, 2) := 0;
  short_over_total numeric(12, 2);
  sold_ticket_count integer;
  start_ticket_value integer;
  target_date_activated timestamptz;
  target_game_id text;
  target_inventory_id uuid;
  target_pack_number text;
  target_ticket_limit integer;
  target_ticket_price numeric(10, 2);
  today_date date := ((timezone('utc', now()))::date);
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
  set end_ticket_no = lpad(end_ticket_no::integer::text, 3, '0')
  where end_ticket_no is not null;

  select count(*)
  into active_bin_count
  from public.inventory inventory_row
  where inventory_row.store_key = target_store_key
    and inventory_row.status = 'active'
    and inventory_row.bin_number is not null;

  select count(distinct daily_audit.bin_number)
  into existing_eod_bin_count
  from public.daily_audits daily_audit
  where daily_audit.store_key = target_store_key
    and daily_audit.audit_date = target_report_date
    and daily_audit.audit_type = 'eod';

  if target_report_date = today_date
    and active_bin_count > (
      select count(*)
      from lottery_eod_bin_entries
    )
  then
    raise exception 'Enter ending ticket numbers for every active bin'
      using errcode = '22023';
  end if;

  if target_report_date <> today_date
    and existing_eod_bin_count > (
      select count(*)
      from lottery_eod_bin_entries
    )
  then
    raise exception 'Enter ending ticket numbers for every bin already reconciled on %',
      target_report_date
      using errcode = '22023';
  end if;

  for bin_entry in
    select entry.bin_number, entry.end_ticket_no
    from lottery_eod_bin_entries entry
    order by entry.bin_number
  loop
    target_inventory_id := null;
    target_game_id := null;
    target_pack_number := null;
    target_date_activated := null;
    target_ticket_limit := null;
    target_ticket_price := null;
    existing_eod_audit_id := null;
    audit_record_id := null;

    select
      daily_audit.audit_id,
      inventory_row.id,
      inventory_row.game_id,
      inventory_row.pack_number,
      inventory_row.date_activated,
      coalesce(inventory_row.pack_ticket_count, game.ticket_count),
      game.ticket_price
    into
      existing_eod_audit_id,
      target_inventory_id,
      target_game_id,
      target_pack_number,
      target_date_activated,
      target_ticket_limit,
      target_ticket_price
    from public.daily_audits daily_audit
    join public.inventory inventory_row
      on inventory_row.id = daily_audit.inventory_id
    join public.game_catalog game
      on game.game_id = inventory_row.game_id
    where daily_audit.store_key = target_store_key
      and daily_audit.audit_date = target_report_date
      and daily_audit.audit_type = 'eod'
      and daily_audit.bin_number = bin_entry.bin_number
    order by daily_audit.created_at desc
    limit 1;

    if target_inventory_id is null then
      select
        inventory_row.id,
        inventory_row.game_id,
        inventory_row.pack_number,
        inventory_row.date_activated,
        coalesce(inventory_row.pack_ticket_count, game.ticket_count),
        game.ticket_price
      into
        target_inventory_id,
        target_game_id,
        target_pack_number,
        target_date_activated,
        target_ticket_limit,
        target_ticket_price
      from public.inventory inventory_row
      join public.game_catalog game
        on game.game_id = inventory_row.game_id
      where inventory_row.store_key = target_store_key
        and inventory_row.status = 'active'
        and inventory_row.bin_number = bin_entry.bin_number
      for update of inventory_row;
    end if;

    if target_inventory_id is null then
      select
        inventory_row.id,
        inventory_row.game_id,
        inventory_row.pack_number,
        inventory_row.date_activated,
        coalesce(inventory_row.pack_ticket_count, game.ticket_count),
        game.ticket_price
      into
        target_inventory_id,
        target_game_id,
        target_pack_number,
        target_date_activated,
        target_ticket_limit,
        target_ticket_price
      from public.daily_audits latest_audit
      join public.inventory inventory_row
        on inventory_row.id = latest_audit.inventory_id
      join public.game_catalog game
        on game.game_id = inventory_row.game_id
      where latest_audit.store_key = target_store_key
        and latest_audit.bin_number = bin_entry.bin_number
        and latest_audit.audit_date <= target_report_date
        and latest_audit.inventory_id is not null
      order by latest_audit.audit_date desc, latest_audit.created_at desc
      limit 1;
    end if;

    if target_inventory_id is null then
      raise exception 'No scratch pack history was found for bin % on %',
        bin_entry.bin_number,
        target_report_date
        using errcode = 'P0002';
    end if;

    normalized_end_ticket := bin_entry.end_ticket_no;
    end_ticket_value := normalized_end_ticket::integer;

    if target_ticket_limit is not null
      and target_ticket_limit > 0
      and end_ticket_value > target_ticket_limit
    then
      raise exception 'Ending ticket number for bin % cannot be greater than pack ticket count %',
        bin_entry.bin_number,
        target_ticket_limit
        using errcode = '22023';
    end if;

    select latest_audit.end_ticket_no
    into normalized_start_ticket
    from public.daily_audits latest_audit
    where latest_audit.store_key = target_store_key
      and latest_audit.inventory_id = target_inventory_id
      and (
        latest_audit.audit_date < target_report_date
        or (
          latest_audit.audit_date = target_report_date
          and coalesce(latest_audit.audit_type, 'shift') <> 'eod'
        )
      )
    order by latest_audit.audit_date desc, latest_audit.created_at desc
    limit 1;

    normalized_start_ticket := coalesce(normalized_start_ticket, '000');
    start_ticket_value := normalized_start_ticket::integer;

    reset_allowed := target_date_activated is not null
      and not exists (
        select 1
        from public.daily_audits prior_audit
        where prior_audit.store_key = target_store_key
          and prior_audit.inventory_id = target_inventory_id
          and (
            prior_audit.audit_date < target_report_date
            or (
              prior_audit.audit_date = target_report_date
              and coalesce(prior_audit.audit_type, 'shift') <> 'eod'
            )
          )
          and (
            prior_audit.tickets_sold > 0
            or prior_audit.calculated_revenue > 0
          )
      );

    if end_ticket_value < start_ticket_value then
      if not reset_allowed then
        raise exception 'Ending ticket number for bin % cannot be lower than its starting ticket number unless a new pack was activated',
          bin_entry.bin_number
          using errcode = '22023';
      end if;

      start_ticket_value := 0;
      normalized_start_ticket := '000';
    end if;

    sold_ticket_count := end_ticket_value - start_ticket_value;
    expected_sales_total := round(
      (sold_ticket_count * target_ticket_price)::numeric,
      2
    );

    select daily_audit.audit_id
    into existing_eod_audit_id
    from public.daily_audits daily_audit
    where daily_audit.store_key = target_store_key
      and daily_audit.audit_date = target_report_date
      and daily_audit.audit_type = 'eod'
      and daily_audit.inventory_id = target_inventory_id
      and daily_audit.bin_number = bin_entry.bin_number
    order by daily_audit.created_at desc
    limit 1;

    if existing_eod_audit_id is null then
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
        target_inventory_id,
        bin_entry.bin_number,
        normalized_start_ticket,
        normalized_end_ticket,
        sold_ticket_count,
        expected_sales_total,
        'eod'
      )
      returning public.daily_audits.audit_id
      into audit_record_id;

      existing_eod_audit_id := audit_record_id;
    else
      update public.daily_audits
      set
        employee_id = reconciled_by,
        start_ticket_no = normalized_start_ticket,
        end_ticket_no = normalized_end_ticket,
        tickets_sold = sold_ticket_count,
        calculated_revenue = expected_sales_total,
        updated_at = timezone('utc', now())
      where public.daily_audits.audit_id = existing_eod_audit_id
      returning public.daily_audits.audit_id
      into audit_record_id;
    end if;

    delete from public.daily_audits duplicate_audit
    where duplicate_audit.store_key = target_store_key
      and duplicate_audit.audit_date = target_report_date
      and duplicate_audit.audit_type = 'eod'
      and duplicate_audit.inventory_id = target_inventory_id
      and duplicate_audit.bin_number = bin_entry.bin_number
      and duplicate_audit.audit_id <> existing_eod_audit_id;

    reconciled_bin_count := reconciled_bin_count + 1;
  end loop;

  select coalesce(sum(daily_audit.calculated_revenue), 0)::numeric(12, 2)
  into scratch_sales_total
  from public.daily_audits daily_audit
  where daily_audit.store_key = target_store_key
    and daily_audit.audit_date = target_report_date;

  expected_cash_total := round(
    greatest(
      (
        scratch_sales_total
        + terminal_sales
        - ticket_cancels
        - online_total_payout
        - scratch_card_total_payout
        - cashing_bonus
      )::numeric,
      0
    ),
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
  on conflict on constraint terminal_reports_store_date_unique do update
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
  on conflict on constraint eod_reconciliation_store_date_unique do update
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

revoke execute on function public.reconcile_scratch_bin(
  text,
  integer,
  text,
  text,
  numeric,
  date,
  uuid
) from public;

grant execute on function public.reconcile_scratch_bin(
  text,
  integer,
  text,
  text,
  numeric,
  date,
  uuid
) to authenticated;
