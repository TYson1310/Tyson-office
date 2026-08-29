alter table public.eod_reconciliation
  add column if not exists opening_cash_float numeric(12, 2) not null default 0;

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
  report_dates as (
    select audit_date as report_date
    from public.daily_audits
    where store_key = p_store_key
      and audit_date <= p_end_date
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
  ),
  audit_by_date as (
    select
      audit_date as report_date,
      round(sum(coalesce(calculated_revenue, 0))::numeric, 2) as scratch_sales
    from public.daily_audits
    where store_key = p_store_key
      and audit_date <= p_end_date
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
      end as cash_amount
    from report_dates
    left join audit_by_date using (report_date)
    left join terminal_by_date using (report_date)
    left join reconciliation_by_date using (report_date)
  ),
  paid_statuses as (
    select
      week_start_date,
      week_end_date,
      sweep_date
    from public.lottery_eft_weekly_status
    where store_key = p_store_key
      and status = 'paid'
      and sweep_date <= p_latest_sweep_date
  ),
  paid_eft_by_week as (
    select
      paid_statuses.sweep_date,
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
      ) as net_eft_due
    from paid_statuses
    cross join normalized_rates
    left join terminal_by_date
      on terminal_by_date.report_date between paid_statuses.week_start_date and paid_statuses.week_end_date
    group by paid_statuses.sweep_date
  ),
  cash_totals as (
    select
      round(coalesce(sum(cash_amount), 0)::numeric, 2) as cash_available_before_paid_eft,
      count(*)::integer as recorded_days
    from daily_cash
  ),
  eft_totals as (
    select
      round(coalesce(sum(net_eft_due), 0)::numeric, 2) as paid_eft_total,
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
