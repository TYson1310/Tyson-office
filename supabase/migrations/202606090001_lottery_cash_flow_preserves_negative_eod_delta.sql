-- Treat saved lottery EOD cash counts as balance snapshots.
-- This prevents historical opening-float drift from inflating current cash in hand.

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
  latest_reconciliation as (
    select
      report_date,
      round(
        (
          coalesce(pos_register_total, 0)::numeric -
          coalesce(opening_cash_float, 0)::numeric
        )::numeric,
        2
      ) as cash_snapshot
    from public.eod_reconciliation
    where store_key = p_store_key
      and report_date <= p_end_date
    order by report_date desc, updated_at desc
    limit 1
  ),
  cutoff as (
    select
      (select report_date from latest_reconciliation) as snapshot_date,
      coalesce((select cash_snapshot from latest_reconciliation), 0) as cash_snapshot
  ),
  cash_advance_impact_rows as (
    select
      advance_date as report_date,
      -round(amount::numeric, 2) as cash_advance_impact
    from public.lottery_cash_advances
    cross join cutoff
    where store_key = p_store_key
      and status = 'posted'
      and advance_date <= p_end_date
      and (
        cutoff.snapshot_date is null
        or advance_date > cutoff.snapshot_date
      )
    union all
    select
      payment_date as report_date,
      round(amount::numeric, 2) as cash_advance_impact
    from public.lottery_cash_advance_payments
    cross join cutoff
    where store_key = p_store_key
      and status = 'posted'
      and payment_date <= p_end_date
      and (
        cutoff.snapshot_date is null
        or payment_date > cutoff.snapshot_date
      )
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
    cross join cutoff
    where store_key = p_store_key
      and status = 'posted'
      and cash_source = 'lottery_till'
      and deposit_date <= p_end_date
      and (
        cutoff.snapshot_date is null
        or deposit_date > cutoff.snapshot_date
      )
    group by deposit_date
  ),
  report_dates as (
    select audit_date as report_date
    from public.daily_audits
    cross join cutoff
    where store_key = p_store_key
      and audit_date <= p_end_date
      and audit_type = 'eod'
      and (
        cutoff.snapshot_date is null
        or audit_date > cutoff.snapshot_date
      )
    union
    select report_date
    from public.terminal_reports
    cross join cutoff
    where store_key = p_store_key
      and report_date <= p_end_date
      and (
        cutoff.snapshot_date is null
        or report_date > cutoff.snapshot_date
      )
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
    cross join cutoff
    where store_key = p_store_key
      and audit_date <= p_end_date
      and audit_type = 'eod'
      and (
        cutoff.snapshot_date is null
        or audit_date > cutoff.snapshot_date
      )
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
    cross join cutoff
    where store_key = p_store_key
      and report_date <= p_end_date
      and (
        cutoff.snapshot_date is null
        or report_date > cutoff.snapshot_date
      )
  ),
  pending_cash_by_date as (
    select
      report_dates.report_date,
      round(
        greatest(
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
        )::numeric,
        2
      ) as cash_amount
    from report_dates
    left join audit_by_date using (report_date)
    left join terminal_by_date using (report_date)
  ),
  movement_totals as (
    select
      round(
        (
          coalesce((select cash_snapshot from cutoff), 0) +
          coalesce((select sum(cash_amount) from pending_cash_by_date), 0) +
          coalesce((select sum(cash_advance_impact) from cash_advance_impact_by_date), 0) +
          coalesce((select sum(cash_deposit_impact) from lottery_deposit_impact_by_date), 0)
        )::numeric,
        2
      ) as cash_available_before_paid_eft,
      (
        select count(distinct report_date)::integer
        from (
          select report_date from report_dates
          union
          select snapshot_date from cutoff where snapshot_date is not null
        ) counted_days
      ) as recorded_days
  ),
  paid_statuses as (
    select
      week_start_date,
      week_end_date,
      sweep_date,
      paid_amount
    from public.lottery_eft_weekly_status
    cross join cutoff
    where store_key = p_store_key
      and status = 'paid'
      and sweep_date <= p_latest_sweep_date
      and (
        cutoff.snapshot_date is null
        or sweep_date > cutoff.snapshot_date
      )
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
  eft_totals as (
    select
      round(coalesce(sum(applied_eft_paid), 0)::numeric, 2) as paid_eft_total,
      count(*)::integer as paid_eft_weeks
    from paid_eft_by_week
  )
  select
    round(
      (
        movement_totals.cash_available_before_paid_eft -
        eft_totals.paid_eft_total
      )::numeric,
      2
    ) as cash_after_eft,
    movement_totals.cash_available_before_paid_eft,
    eft_totals.paid_eft_total,
    eft_totals.paid_eft_weeks,
    movement_totals.recorded_days
  from movement_totals
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

-- Recalculate saved EOD expected cash after switching to EOD scratch audits
-- and held-float-aware cash-in-hand logic. Physical counted cash is preserved.
with audit_by_date as (
  select
    store_key,
    audit_date as report_date,
    round(sum(coalesce(calculated_revenue, 0))::numeric, 2) as scratch_sales
  from public.daily_audits
  where audit_type = 'eod'
  group by store_key, audit_date
),
terminal_by_date as (
  select
    store_key,
    report_date,
    round(coalesce(sum(draw_sales), 0)::numeric, 2) as draw_sales,
    round(coalesce(sum(draw_payouts), 0)::numeric, 2) as draw_payouts,
    round(coalesce(sum(scratch_payouts), 0)::numeric, 2) as scratch_payouts,
    round(coalesce(sum(total_cashing_bonus), 0)::numeric, 2) as promo_credits,
    round(coalesce(sum(total_cancels), 0)::numeric, 2) as ticket_cancels
  from public.terminal_reports
  group by store_key, report_date
),
recalculated_eod as (
  select
    reconciliation.id,
    round(
      greatest(
        (
          coalesce(reconciliation.opening_cash_float, 0)::numeric +
          coalesce(audit_by_date.scratch_sales, 0) +
          coalesce(terminal_by_date.draw_sales, 0) -
          coalesce(terminal_by_date.draw_payouts, 0) -
          coalesce(terminal_by_date.scratch_payouts, 0) -
          coalesce(terminal_by_date.promo_credits, 0) -
          coalesce(terminal_by_date.ticket_cancels, 0)
        )::numeric,
        0
      ),
      2
    ) as total_expected_cash
  from public.eod_reconciliation reconciliation
  left join audit_by_date
    on audit_by_date.store_key = reconciliation.store_key
    and audit_by_date.report_date = reconciliation.report_date
  left join terminal_by_date
    on terminal_by_date.store_key = reconciliation.store_key
    and terminal_by_date.report_date = reconciliation.report_date
)
update public.eod_reconciliation reconciliation
set
  total_expected_cash = recalculated_eod.total_expected_cash,
  updated_at = timezone('utc', now())
from recalculated_eod
where reconciliation.id = recalculated_eod.id
  and reconciliation.total_expected_cash is distinct from recalculated_eod.total_expected_cash;
