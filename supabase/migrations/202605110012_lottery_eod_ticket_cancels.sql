drop function if exists public.save_lottery_eod_reconciliation(
  text,
  date,
  jsonb,
  numeric,
  numeric,
  numeric,
  numeric,
  text,
  uuid
);

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

  if exists (
    select 1
    from public.daily_audits daily_audit
    left join public.inventory inventory_row
      on inventory_row.id = daily_audit.inventory_id
    where daily_audit.store_key = target_store_key
      and daily_audit.audit_date = target_report_date
      and daily_audit.end_ticket_no::integer < daily_audit.start_ticket_no::integer
      and not (
        inventory_row.date_activated is not null
        and not exists (
          select 1
          from public.daily_audits prior_audit
          where prior_audit.store_key = daily_audit.store_key
            and prior_audit.inventory_id = daily_audit.inventory_id
            and prior_audit.audit_id <> daily_audit.audit_id
            and (
              prior_audit.tickets_sold > 0
              or prior_audit.calculated_revenue > 0
            )
        )
      )
  ) then
    raise exception 'End ticket number must be greater than or equal to start ticket number unless a new pack was activated'
      using errcode = '22023';
  end if;

  select coalesce(
    sum(
      case
        when game.game_id is not null then
          round(
            (
              (
                case
                  when daily_audit.end_ticket_no::integer >= daily_audit.start_ticket_no::integer
                  then daily_audit.end_ticket_no::integer - daily_audit.start_ticket_no::integer
                  else daily_audit.end_ticket_no::integer
                end
              ) * game.ticket_price
            )::numeric,
            2
          )
        else daily_audit.calculated_revenue
      end
    ),
    0
  )::numeric(12, 2)
  into scratch_sales_total
  from public.daily_audits daily_audit
  left join public.inventory inventory_row
    on inventory_row.id = daily_audit.inventory_id
  left join public.game_catalog game
    on game.game_id = inventory_row.game_id
  where daily_audit.store_key = target_store_key
    and daily_audit.audit_date = target_report_date;

  select
    coalesce(sum(terminal_report.draw_sales), 0)::numeric(12, 2),
    coalesce(sum(terminal_report.draw_payouts), 0)::numeric(12, 2),
    coalesce(sum(terminal_report.scratch_payouts), 0)::numeric(12, 2),
    coalesce(sum(terminal_report.total_cancels), 0)::numeric(12, 2)
  into
    draw_sales_total,
    draw_payouts_total,
    scratch_payouts_total,
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

create or replace function public.save_lottery_eod_reconciliation(
  target_store_key text,
  target_report_date date default ((timezone('utc', now()))::date),
  bin_entries jsonb default '[]'::jsonb,
  terminal_sales numeric default 0,
  ticket_cancels numeric default 0,
  online_total_payout numeric default 0,
  scratch_card_total_payout numeric default 0,
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
  audit_record_id uuid;
  existing_inventory_id uuid;
  normalized_end_ticket text;
  normalized_start_ticket text;
  start_ticket_value integer;
  end_ticket_value integer;
  reset_allowed boolean;
  sold_ticket_count integer;
  expected_sales_total numeric(12, 2);
  scratch_sales_total numeric(12, 2) := 0;
  expected_cash_total numeric(12, 2);
  short_over_total numeric(12, 2);
  reconciled_bin_count integer := 0;
begin
  if reconciled_by is null then
    raise exception 'An authenticated employee is required for end-of-day reconciliation'
      using errcode = '42501';
  end if;

  if not (
    select public.can_access_store(
      target_store_key,
      array['admin', 'manager', 'accountant', 'cashier', 'employee']
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

    audit_record_id := null;
    existing_inventory_id := null;
    normalized_start_ticket := null;

    select
      existing_audit.audit_id,
      existing_audit.inventory_id,
      existing_audit.start_ticket_no
    into
      audit_record_id,
      existing_inventory_id,
      normalized_start_ticket
    from public.daily_audits existing_audit
    where existing_audit.store_key = target_store_key
      and existing_audit.audit_date = target_report_date
      and existing_audit.bin_number = active_pack.bin_number
    order by existing_audit.created_at
    limit 1
    for update;

    if normalized_start_ticket is null then
      select prior_audit.end_ticket_no
      into normalized_start_ticket
      from public.daily_audits prior_audit
      where prior_audit.store_key = target_store_key
        and prior_audit.inventory_id = active_pack.inventory_id
        and prior_audit.audit_date < target_report_date
      order by prior_audit.audit_date desc, prior_audit.created_at desc
      limit 1;

      normalized_start_ticket := coalesce(normalized_start_ticket, '000');
    end if;

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
    end if;

    normalized_start_ticket := lpad(start_ticket_value::text, 3, '0');
    sold_ticket_count := end_ticket_value - start_ticket_value;
    expected_sales_total := round(
      (sold_ticket_count * active_pack.ticket_price)::numeric,
      2
    );
    scratch_sales_total := scratch_sales_total + expected_sales_total;

    if audit_record_id is null then
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
        target_report_date,
        reconciled_by,
        active_pack.inventory_id,
        active_pack.bin_number,
        normalized_start_ticket,
        normalized_end_ticket,
        sold_ticket_count,
        expected_sales_total
      );
    else
      update public.daily_audits
      set
        employee_id = reconciled_by,
        inventory_id = active_pack.inventory_id,
        start_ticket_no = normalized_start_ticket,
        end_ticket_no = normalized_end_ticket,
        tickets_sold = sold_ticket_count,
        calculated_revenue = expected_sales_total,
        updated_at = timezone('utc', now())
      where public.daily_audits.audit_id = audit_record_id;
    end if;

    reconciled_bin_count := reconciled_bin_count + 1;
  end loop;

  scratch_sales_total := round(scratch_sales_total, 2);
  expected_cash_total := round(
    (
      scratch_sales_total
      + terminal_sales
      - ticket_cancels
      - online_total_payout
      - scratch_card_total_payout
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
    0,
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

revoke execute on function public.save_lottery_eod_reconciliation(
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
  text,
  uuid
) to authenticated;
