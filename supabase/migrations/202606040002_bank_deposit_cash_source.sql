alter table public.bank_deposits
  add column if not exists cash_source text not null default 'store_till';

alter table public.bank_deposits
  drop constraint if exists bank_deposits_cash_source_check;

alter table public.bank_deposits
  add constraint bank_deposits_cash_source_check
  check (cash_source in ('store_till', 'lottery_till'));

alter table public.cash_vault_transactions
  add column if not exists cash_source text not null default 'store_till';

alter table public.cash_vault_transactions
  drop constraint if exists cash_vault_transactions_cash_source_check;

alter table public.cash_vault_transactions
  add constraint cash_vault_transactions_cash_source_check
  check (cash_source in ('store_till', 'lottery_till'));

create index if not exists cash_vault_transactions_store_key_cash_source_recorded_at_idx
  on public.cash_vault_transactions (
    store_key,
    cash_source,
    recorded_at desc,
    business_date desc
  );

drop function if exists public.upsert_cash_vault_transaction(
  text,
  text,
  uuid,
  text,
  date,
  numeric,
  text,
  timestamptz,
  jsonb
);

create or replace function public.upsert_cash_vault_transaction(
  p_store_key text,
  p_source_table text,
  p_source_id uuid,
  p_movement_type text,
  p_business_date date,
  p_amount numeric,
  p_details text,
  p_recorded_at timestamptz,
  p_metadata jsonb default '{}'::jsonb,
  p_cash_source text default 'store_till'
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_store_key is null or p_source_id is null or coalesce(p_amount, 0) = 0 then
    perform public.delete_cash_vault_transaction(
      p_source_table,
      p_source_id,
      p_movement_type
    );
    return;
  end if;

  insert into public.cash_vault_transactions (
    store_key,
    source_table,
    source_id,
    movement_type,
    business_date,
    cash_source,
    amount,
    details,
    metadata,
    recorded_at
  )
  values (
    p_store_key,
    p_source_table,
    p_source_id,
    p_movement_type,
    p_business_date,
    coalesce(nullif(btrim(p_cash_source), ''), 'store_till'),
    round(p_amount::numeric, 2),
    coalesce(nullif(btrim(p_details), ''), 'Cash movement logged'),
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_recorded_at, timezone('utc', now()))
  )
  on conflict (source_table, source_id, movement_type)
  do update set
    store_key = excluded.store_key,
    business_date = excluded.business_date,
    cash_source = excluded.cash_source,
    amount = excluded.amount,
    details = excluded.details,
    metadata = excluded.metadata,
    recorded_at = excluded.recorded_at,
    updated_at = timezone('utc', now());
end;
$$;

create or replace function public.sync_cash_vault_from_bank_deposit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'bank_deposits',
      old.id,
      'bank_deposit'
    );
    return old;
  end if;

  if coalesce(new.cash_source, 'store_till') = 'lottery_till' then
    perform public.delete_cash_vault_transaction(
      'bank_deposits',
      new.id,
      'bank_deposit'
    );
    return new;
  end if;

  if coalesce(new.status, 'posted') = 'posted' and coalesce(new.amount, 0) > 0 then
    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'bank_deposits',
      new.id,
      'bank_deposit',
      new.deposit_date,
      new.amount * -1,
      coalesce(nullif(btrim(new.notes), ''), 'Deposit posted to bank'),
      coalesce(new.updated_at, new.created_at, timezone('utc', now())),
      jsonb_build_object(
        'cashSource', new.cash_source,
        'createdBy', new.created_by,
        'slipPhotoUrl', new.slip_photo_url,
        'status', new.status
      ),
      new.cash_source
    );
  else
    perform public.delete_cash_vault_transaction(
      'bank_deposits',
      new.id,
      'bank_deposit'
    );
  end if;

  return new;
end;
$$;

update public.bank_deposits
set cash_source = coalesce(nullif(btrim(cash_source), ''), 'store_till')
where cash_source is null
   or btrim(cash_source) = '';

update public.cash_vault_transactions
set cash_source = coalesce(
  nullif(btrim(cash_source), ''),
  nullif(btrim(metadata ->> 'cashSource'), ''),
  'store_till'
)
where cash_source is null
   or btrim(cash_source) = '';

delete from public.cash_vault_transactions
where source_table = 'bank_deposits'
  and movement_type = 'bank_deposit'
  and (
    cash_source = 'lottery_till'
    or metadata ->> 'cashSource' = 'lottery_till'
  );

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
