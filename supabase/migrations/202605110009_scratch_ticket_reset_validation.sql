create or replace function public.auto_carry_forward_lottery_day(
  target_store_key text,
  target_audit_date date default ((timezone('utc', now()))::date),
  opened_by uuid default auth.uid()
)
returns table (
  audit_id uuid,
  inventory_id uuid,
  bin_number integer,
  start_ticket_no text,
  previous_end_ticket_no text,
  source_audit_date date,
  carried_forward boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_audit_date date;
  carried_row record;
  existing_audit_id uuid;
  saved_audit_id uuid;
begin
  if opened_by is null then
    raise exception 'An authenticated employee is required to open a lottery day'
      using errcode = '42501';
  end if;

  if not (
    select public.can_access_store(
      target_store_key,
      array['admin', 'manager', 'cashier', 'employee']
    )
  ) then
    raise exception 'Forbidden: opening lottery day is not available for this store'
      using errcode = '42501';
  end if;

  if target_audit_date is null then
    raise exception 'Audit date is required'
      using errcode = '22023';
  end if;

  previous_audit_date := target_audit_date - 1;
  perform pg_advisory_xact_lock(
    hashtext(target_store_key),
    target_audit_date - date '2000-01-01'
  );

  for carried_row in
    select
      active_inventory.id as inventory_id,
      active_inventory.bin_number,
      coalesce(previous_audit.end_ticket_no, '000') as previous_end_ticket_no,
      previous_audit.audit_date,
      case
        when previous_audit.audit_id is null then '000'
        when previous_audit.inventory_id = active_inventory.id then previous_audit.end_ticket_no
        else '000'
      end as opening_start_ticket_no,
      previous_audit.audit_id is not null
        and previous_audit.inventory_id = active_inventory.id as should_carry_forward
    from public.inventory active_inventory
    left join (
      select distinct on (daily_audit.bin_number)
        daily_audit.audit_id,
        daily_audit.inventory_id,
        daily_audit.bin_number,
        daily_audit.end_ticket_no,
        daily_audit.audit_date,
        daily_audit.created_at
      from public.daily_audits daily_audit
      where daily_audit.store_key = target_store_key
        and daily_audit.audit_date = previous_audit_date
      order by
        daily_audit.bin_number,
        daily_audit.created_at desc
    ) previous_audit
      on previous_audit.bin_number = active_inventory.bin_number
    where active_inventory.store_key = target_store_key
      and active_inventory.status = 'active'
      and active_inventory.bin_number is not null
    order by active_inventory.bin_number
  loop
    select current_audit.audit_id
    into existing_audit_id
    from public.daily_audits current_audit
    where current_audit.store_key = target_store_key
      and current_audit.audit_date = target_audit_date
      and current_audit.bin_number = carried_row.bin_number
    order by current_audit.created_at
    limit 1
    for update;

    if existing_audit_id is null then
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
        target_audit_date,
        opened_by,
        carried_row.inventory_id,
        carried_row.bin_number,
        carried_row.opening_start_ticket_no,
        carried_row.opening_start_ticket_no,
        0,
        0
      )
      returning public.daily_audits.audit_id
      into saved_audit_id;
    else
      update public.daily_audits
      set
        inventory_id = case
          when public.daily_audits.tickets_sold = 0
            and public.daily_audits.calculated_revenue = 0
          then carried_row.inventory_id
          else public.daily_audits.inventory_id
        end,
        employee_id = coalesce(public.daily_audits.employee_id, opened_by),
        start_ticket_no = case
          when public.daily_audits.tickets_sold = 0
            and public.daily_audits.calculated_revenue = 0
          then carried_row.opening_start_ticket_no
          else public.daily_audits.start_ticket_no
        end,
        end_ticket_no = case
          when public.daily_audits.tickets_sold = 0
            and public.daily_audits.calculated_revenue = 0
          then carried_row.opening_start_ticket_no
          else public.daily_audits.end_ticket_no
        end,
        updated_at = timezone('utc', now())
      where public.daily_audits.audit_id = existing_audit_id
      returning public.daily_audits.audit_id
      into saved_audit_id;
    end if;

    return query
    select
      saved_audit_id,
      carried_row.inventory_id,
      carried_row.bin_number,
      carried_row.opening_start_ticket_no,
      carried_row.previous_end_ticket_no,
      carried_row.audit_date,
      carried_row.should_carry_forward;
  end loop;
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
    coalesce(sum(terminal_report.scratch_payouts), 0)::numeric(12, 2)
  into
    draw_sales_total,
    draw_payouts_total,
    scratch_payouts_total
  from public.terminal_reports terminal_report
  where terminal_report.store_key = target_store_key
    and terminal_report.report_date = target_report_date;

  expected_cash_total := round(
    (
      scratch_sales_total
      + draw_sales_total
      - draw_payouts_total
      - scratch_payouts_total
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
  discrepancy_total numeric(12, 2);
  audit_record_id uuid;
  reset_allowed boolean;
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
  normalized_end_ticket := lpad(end_ticket_value::text, 3, '0');
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

  select existing_audit.audit_id
  into audit_record_id
  from public.daily_audits existing_audit
  where existing_audit.store_key = target_store_key
    and existing_audit.audit_date = (timezone('utc', now()))::date
    and existing_audit.bin_number = target_bin_number
  order by existing_audit.created_at
  limit 1
  for update;

  reset_allowed := active_pack.date_activated is not null
    and not exists (
      select 1
      from public.daily_audits prior_audit
      where prior_audit.store_key = target_store_key
        and prior_audit.inventory_id = active_pack.inventory_id
        and (
          audit_record_id is null
          or prior_audit.audit_id <> audit_record_id
        )
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
  end if;

  normalized_start_ticket := lpad(start_ticket_value::text, 3, '0');
  sold_ticket_count := end_ticket_value - start_ticket_value;
  expected_sales_total := round(
    (sold_ticket_count * active_pack.ticket_price)::numeric,
    2
  );
  discrepancy_total := expected_sales_total - normalized_pos_sales;

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

  perform *
  from public.reconciliation_engine(
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
    normalized_start_ticket,
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
