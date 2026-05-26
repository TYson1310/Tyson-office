alter table public.terminal_reports
  add column if not exists scratch_returns numeric(12, 2) not null default 0;

alter table public.terminal_report_revisions
  add column if not exists scratch_returns numeric(12, 2) not null default 0;

alter table public.terminal_reports
  drop constraint if exists terminal_reports_amounts_nonnegative;

alter table public.terminal_reports
  add constraint terminal_reports_amounts_nonnegative check (
    draw_sales >= 0
    and draw_payouts >= 0
    and scratch_payouts >= 0
    and total_cashing_bonus >= 0
    and total_cancels >= 0
    and scratch_returns >= 0
  );

alter table public.inventory
  add column if not exists date_returned timestamptz,
  add column if not exists returned_ticket_count integer,
  add column if not exists returned_value numeric(12, 2),
  add column if not exists returned_by uuid references public.profiles (id) on delete set null;

alter table public.inventory
  drop constraint if exists inventory_returned_ticket_count_nonnegative,
  drop constraint if exists inventory_returned_value_nonnegative;

alter table public.inventory
  add constraint inventory_returned_ticket_count_nonnegative check (
    returned_ticket_count is null or returned_ticket_count >= 0
  ),
  add constraint inventory_returned_value_nonnegative check (
    returned_value is null or returned_value >= 0
  );

create index if not exists inventory_store_returned_at_idx
on public.inventory (store_key, date_returned desc)
where status = 'returned';

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
    scratch_returns,
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
    old.scratch_returns,
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
  scratch_returns_total numeric(12, 2);
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
    coalesce(sum(terminal_report.total_cancels), 0)::numeric(12, 2),
    coalesce(sum(terminal_report.scratch_returns), 0)::numeric(12, 2)
  into
    draw_sales_total,
    draw_payouts_total,
    scratch_payouts_total,
    cashing_bonus_total,
    ticket_cancels_total,
    scratch_returns_total
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
        - scratch_returns_total
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

create or replace function public.return_scratch_pack_to_lottery(
  target_store_key text,
  target_inventory_id uuid default null,
  target_bin_number integer default null,
  returned_by uuid default auth.uid()
)
returns table (
  inventory_id uuid,
  pack_number text,
  game_id text,
  bin_number integer,
  returned_ticket_count integer,
  returned_value numeric(12, 2),
  report_date date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  active_pack record;
  actor_user_id uuid := returned_by;
  last_ticket_number text;
  normalized_report_date date := ((timezone('utc', now()))::date);
  total_ticket_count integer;
  return_ticket_count integer;
  return_value_total numeric(12, 2);
begin
  if actor_user_id is null then
    raise exception 'An authenticated manager is required to return scratch packs'
      using errcode = '42501';
  end if;

  if not (select public.can_access_store(target_store_key, array['admin', 'manager'])) then
    raise exception 'Forbidden: returning scratch packs requires admin or manager access'
      using errcode = '42501';
  end if;

  if target_inventory_id is null and target_bin_number is null then
    raise exception 'Inventory id or bin number is required'
      using errcode = '22023';
  end if;

  if target_bin_number is not null and target_bin_number <= 0 then
    raise exception 'Bin number must be a positive integer'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_store_key), coalesce(target_bin_number, 0));

  select
    inventory_row.id,
    inventory_row.pack_number,
    inventory_row.game_id,
    inventory_row.bin_number,
    inventory_row.pack_ticket_count,
    game.ticket_count,
    game.ticket_price
  into active_pack
  from public.inventory inventory_row
  join public.game_catalog game
    on game.game_id = inventory_row.game_id
  where inventory_row.store_key = target_store_key
    and inventory_row.status = 'active'
    and (
      (target_inventory_id is not null and inventory_row.id = target_inventory_id)
      or (target_inventory_id is null and inventory_row.bin_number = target_bin_number)
    )
  for update of inventory_row;

  if active_pack.id is null then
    raise exception 'No active scratch pack was found to return'
      using errcode = 'P0002';
  end if;

  if target_bin_number is not null and active_pack.bin_number <> target_bin_number then
    raise exception 'Pack % is not active in bin %', active_pack.pack_number, target_bin_number
      using errcode = '22023';
  end if;

  total_ticket_count := coalesce(active_pack.pack_ticket_count, active_pack.ticket_count);

  if total_ticket_count is null or total_ticket_count <= 0 then
    raise exception 'Pack % is missing a valid ticket count', active_pack.pack_number
      using errcode = '22023';
  end if;

  select latest_audit.end_ticket_no
  into last_ticket_number
  from public.daily_audits latest_audit
  where latest_audit.store_key = target_store_key
    and latest_audit.inventory_id = active_pack.id
  order by latest_audit.audit_date desc, latest_audit.created_at desc
  limit 1;

  last_ticket_number := coalesce(last_ticket_number, '000');
  return_ticket_count := greatest(total_ticket_count - last_ticket_number::integer, 0);
  return_value_total := round((return_ticket_count * active_pack.ticket_price)::numeric, 2);

  update public.inventory
  set
    status = 'returned',
    bin_number = null,
    date_returned = timezone('utc', now()),
    returned_ticket_count = return_ticket_count,
    returned_value = return_value_total,
    returned_by = actor_user_id
  where public.inventory.id = active_pack.id;

  insert into public.terminal_reports (
    store_key,
    report_date,
    scratch_returns,
    created_by
  )
  values (
    target_store_key,
    normalized_report_date,
    return_value_total,
    actor_user_id
  )
  on conflict on constraint terminal_reports_store_date_unique do update
  set
    scratch_returns = public.terminal_reports.scratch_returns + excluded.scratch_returns,
    created_by = coalesce(excluded.created_by, public.terminal_reports.created_by),
    updated_at = timezone('utc', now());

  perform public.reconciliation_engine(
    target_store_key,
    normalized_report_date,
    null,
    null,
    null
  );

  return query
  select
    active_pack.id,
    active_pack.pack_number,
    active_pack.game_id,
    active_pack.bin_number,
    return_ticket_count,
    return_value_total,
    normalized_report_date;
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
  active_pack record;
  end_ticket_value integer;
  expected_cash_total numeric(12, 2);
  expected_sales_total numeric(12, 2);
  normalized_end_ticket text;
  normalized_start_ticket text;
  reconciled_bin_count integer := 0;
  reset_allowed boolean;
  scratch_returns_total numeric(12, 2) := 0;
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

  select coalesce(sum(terminal_report.scratch_returns), 0)::numeric(12, 2)
  into scratch_returns_total
  from public.terminal_reports terminal_report
  where terminal_report.store_key = target_store_key
    and terminal_report.report_date = target_report_date;

  expected_cash_total := round(
    greatest(
      (
        scratch_sales_total
        + terminal_sales
        - ticket_cancels
        - online_total_payout
        - scratch_card_total_payout
        - cashing_bonus
        - scratch_returns_total
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

revoke execute on function public.return_scratch_pack_to_lottery(
  text,
  uuid,
  integer,
  uuid
) from public;
grant execute on function public.return_scratch_pack_to_lottery(
  text,
  uuid,
  integer,
  uuid
) to authenticated;
