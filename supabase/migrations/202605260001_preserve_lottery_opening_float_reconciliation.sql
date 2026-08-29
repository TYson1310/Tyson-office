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
  opening_cash_float_total numeric(12, 2);
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

  select coalesce(reconciliation.opening_cash_float, 0)::numeric(12, 2)
  into opening_cash_float_total
  from public.eod_reconciliation reconciliation
  where reconciliation.store_key = target_store_key
    and reconciliation.report_date = target_report_date;

  opening_cash_float_total := coalesce(opening_cash_float_total, 0);

  expected_cash_total := round(
    greatest(
      (
        opening_cash_float_total
        + scratch_sales_total
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
