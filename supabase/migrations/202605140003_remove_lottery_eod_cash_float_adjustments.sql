with scratch_totals as (
  select
    store_key,
    audit_date as report_date,
    coalesce(sum(calculated_revenue), 0)::numeric(12, 2) as scratch_sales
  from public.daily_audits
  group by store_key, audit_date
),
terminal_totals as (
  select
    store_key,
    report_date,
    coalesce(
      sum(
        draw_sales
        - draw_payouts
        - scratch_payouts
        - total_cashing_bonus
        - total_cancels
      ),
      0
    )::numeric(12, 2) as terminal_cash
  from public.terminal_reports
  group by store_key, report_date
),
recalculated as (
  select
    reconciliation.id,
    round(
      greatest(
        coalesce(scratch_totals.scratch_sales, 0)
        + coalesce(terminal_totals.terminal_cash, 0),
        0
      ),
      2
    ) as total_expected_cash
  from public.eod_reconciliation reconciliation
  left join scratch_totals
    on scratch_totals.store_key = reconciliation.store_key
    and scratch_totals.report_date = reconciliation.report_date
  left join terminal_totals
    on terminal_totals.store_key = reconciliation.store_key
    and terminal_totals.report_date = reconciliation.report_date
)
update public.eod_reconciliation reconciliation
set
  total_expected_cash = recalculated.total_expected_cash,
  opening_cash_float = 0,
  closing_cash_float = 0,
  updated_at = timezone('utc', now())
from recalculated
where recalculated.id = reconciliation.id;

create or replace function public.save_lottery_eod_cash_floats(
  target_store_key text,
  target_report_date date,
  cash_opening_float numeric default 0,
  cash_closing_float numeric default 0,
  cash_total_expected numeric default 0,
  cash_till_total numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  scratch_sales_total numeric(12, 2);
  terminal_cash_total numeric(12, 2);
  recalculated_expected_cash numeric(12, 2);
begin
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

  if cash_opening_float < 0
    or cash_closing_float < 0
    or cash_total_expected < 0
    or cash_till_total < 0
  then
    raise exception 'Lottery reconciliation amounts must be zero or greater'
      using errcode = '22023';
  end if;

  select coalesce(sum(calculated_revenue), 0)::numeric(12, 2)
  into scratch_sales_total
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

  recalculated_expected_cash := round(
    greatest(
      scratch_sales_total + terminal_cash_total,
      0
    ),
    2
  );

  update public.eod_reconciliation reconciliation
  set
    opening_cash_float = 0,
    closing_cash_float = 0,
    total_expected_cash = recalculated_expected_cash,
    pos_register_total = round(cash_till_total, 2),
    updated_at = timezone('utc', now())
  where reconciliation.store_key = target_store_key
    and reconciliation.report_date = target_report_date;

  if not found then
    raise exception 'Lottery EOD reconciliation was not found for % on %',
      target_store_key,
      target_report_date
      using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.save_lottery_eod_cash_floats(
  text,
  date,
  numeric,
  numeric,
  numeric,
  numeric
) from public;

grant execute on function public.save_lottery_eod_cash_floats(
  text,
  date,
  numeric,
  numeric,
  numeric,
  numeric
) to authenticated;
