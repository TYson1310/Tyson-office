-- Migration: Lottery EOD cash uses EOD audit revenue only
-- Description: Prevent shift/sold-out scratch audit rows from inflating lottery EOD expected cash, short/over, and cash-in-hand summaries.

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
    and daily_audit.audit_date = target_report_date
    and daily_audit.audit_type = 'eod';

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

create or replace function public.get_lottery_cash_in_hand_summary(
  p_store_key text,
  p_end_date date,
  p_latest_sweep_date date,
  p_retailer_commission_rate numeric default 0,
  p_payout_commission_rate numeric default 0
)
returns table (
  cash_after_eft numeric,
  cash_available_before_paid_eft numeric,
  paid_eft_total numeric,
  paid_eft_weeks integer,
  recorded_days integer
)
language sql
stable
as $$
  with normalized_rates as (
    select
      least(greatest(coalesce(p_retailer_commission_rate, 0), 0), 100) / 100 as retailer_rate,
      least(greatest(coalesce(p_payout_commission_rate, 0), 0), 100) / 100 as payout_rate
  ),
  cash_advance_impact_rows as (
    select
      advance_date as report_date,
      -round(amount::numeric, 2) as cash_advance_impact
    from public.lottery_cash_advances
    where store_key = p_store_key
      and status = 'posted'
      and advance_date <= p_end_date
    union all
    select
      payment_date as report_date,
      round(amount::numeric, 2) as cash_advance_impact
    from public.lottery_cash_advance_payments
    where store_key = p_store_key
      and status = 'posted'
      and payment_date <= p_end_date
  ),
  cash_advance_impact_by_date as (
    select
      report_date,
      round(sum(cash_advance_impact)::numeric, 2) as cash_advance_impact
    from cash_advance_impact_rows
    group by report_date
  ),
  lottery_deposit_impact_by_date as (
    select
      deposit_date as report_date,
      -round(sum(amount)::numeric, 2) as cash_deposit_impact
    from public.bank_deposits
    where store_key = p_store_key
      and status = 'posted'
      and cash_source = 'lottery_till'
      and deposit_date <= p_end_date
    group by deposit_date
  ),
  report_dates as (
    select audit_date as report_date
    from public.daily_audits
    where store_key = p_store_key
      and audit_date <= p_end_date
      and audit_type = 'eod'
    union
    select report_date
    from public.terminal_reports
    where store_key = p_store_key
      and report_date <= p_end_date
    union
    select report_date
    from public.eod_reconciliation
    where store_key = p_store_key
      and report_date <= p_end_date
    union
    select report_date
    from cash_advance_impact_by_date
    union
    select report_date
    from lottery_deposit_impact_by_date
  ),
  audit_by_date as (
    select
      audit_date as report_date,
      round(sum(coalesce(calculated_revenue, 0))::numeric, 2) as scratch_sales
    from public.daily_audits
    where store_key = p_store_key
      and audit_date <= p_end_date
      and audit_type = 'eod'
    group by audit_date
  ),
  terminal_by_date as (
    select
      report_date,
      round(coalesce(draw_sales, 0)::numeric, 2) as draw_sales,
      round(coalesce(draw_payouts, 0)::numeric, 2) as draw_payouts,
      round(coalesce(scratch_payouts, 0)::numeric, 2) as scratch_payouts,
      round(coalesce(total_cashing_bonus, 0)::numeric, 2) as promo_credits,
      round(coalesce(total_cancels, 0)::numeric, 2) as ticket_cancels,
      round(coalesce(lottery_bonding_fee, 0)::numeric, 2) as bonding_fee
    from public.terminal_reports
    where store_key = p_store_key
      and report_date <= p_end_date
  ),
  reconciliation_by_date as (
    select
      report_date,
      round(
        greatest(
          coalesce(pos_register_total, 0)::numeric -
          coalesce(opening_cash_float, 0)::numeric,
          0
        ),
        2
      ) as cash_counted
    from public.eod_reconciliation
    where store_key = p_store_key
      and report_date <= p_end_date
  ),
  daily_cash as (
    select
      report_dates.report_date,
      round(
        (
          case
            when reconciliation_by_date.report_date is not null then reconciliation_by_date.cash_counted
            else greatest(
              (
                coalesce(audit_by_date.scratch_sales, 0) +
                coalesce(terminal_by_date.draw_sales, 0) -
                coalesce(terminal_by_date.ticket_cancels, 0)
              ) -
              (
                coalesce(terminal_by_date.draw_payouts, 0) +
                coalesce(terminal_by_date.scratch_payouts, 0) +
                coalesce(terminal_by_date.promo_credits, 0)
              ),
              0
            )
          end +
          coalesce(cash_advance_impact_by_date.cash_advance_impact, 0) +
          coalesce(lottery_deposit_impact_by_date.cash_deposit_impact, 0)
        )::numeric,
        2
      ) as cash_amount
    from report_dates
    left join audit_by_date using (report_date)
    left join terminal_by_date using (report_date)
    left join reconciliation_by_date using (report_date)
    left join cash_advance_impact_by_date using (report_date)
    left join lottery_deposit_impact_by_date using (report_date)
  ),
  paid_statuses as (
    select
      week_start_date,
      week_end_date,
      sweep_date,
      paid_amount
    from public.lottery_eft_weekly_status
    where store_key = p_store_key
      and status = 'paid'
      and sweep_date <= p_latest_sweep_date
  ),
  paid_eft_by_week as (
    select
      paid_statuses.sweep_date,
      coalesce(
        round(paid_statuses.paid_amount::numeric, 2),
        round(
          coalesce(
            sum(
              (
                coalesce(terminal_by_date.draw_sales, 0) -
                coalesce(terminal_by_date.ticket_cancels, 0)
              ) -
              (
                (
                  coalesce(terminal_by_date.draw_sales, 0) -
                  coalesce(terminal_by_date.ticket_cancels, 0)
                ) * normalized_rates.retailer_rate
              ) -
              (
                (
                  coalesce(terminal_by_date.draw_payouts, 0) +
                  coalesce(terminal_by_date.scratch_payouts, 0)
                ) * normalized_rates.payout_rate
              ) -
              (
                coalesce(terminal_by_date.draw_payouts, 0) +
                coalesce(terminal_by_date.scratch_payouts, 0)
              ) -
              coalesce(terminal_by_date.promo_credits, 0) +
              coalesce(terminal_by_date.bonding_fee, 0)
            ),
            0
          )::numeric,
          2
        )
      ) as applied_eft_paid
    from paid_statuses
    cross join normalized_rates
    left join terminal_by_date
      on terminal_by_date.report_date between paid_statuses.week_start_date and paid_statuses.week_end_date
    group by paid_statuses.sweep_date, paid_statuses.paid_amount
  ),
  cash_totals as (
    select
      round(coalesce(sum(cash_amount), 0)::numeric, 2) as cash_available_before_paid_eft,
      count(*)::integer as recorded_days
    from daily_cash
  ),
  eft_totals as (
    select
      round(coalesce(sum(applied_eft_paid), 0)::numeric, 2) as paid_eft_total,
      count(*)::integer as paid_eft_weeks
    from paid_eft_by_week
  )
  select
    round(
      (
        cash_totals.cash_available_before_paid_eft -
        eft_totals.paid_eft_total
      )::numeric,
      2
    ) as cash_after_eft,
    cash_totals.cash_available_before_paid_eft,
    eft_totals.paid_eft_total,
    eft_totals.paid_eft_weeks,
    cash_totals.recorded_days
  from cash_totals
  cross join eft_totals;
$$;

revoke execute on function public.get_lottery_cash_in_hand_summary(
  text,
  date,
  date,
  numeric,
  numeric
) from public;

grant execute on function public.get_lottery_cash_in_hand_summary(
  text,
  date,
  date,
  numeric,
  numeric
) to authenticated;
