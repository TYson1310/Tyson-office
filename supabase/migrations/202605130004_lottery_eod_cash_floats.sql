alter table public.eod_reconciliation
  add column if not exists opening_cash_float numeric(12, 2) not null default 0,
  add column if not exists closing_cash_float numeric(12, 2) not null default 0;

alter table public.eod_reconciliation
  drop constraint if exists eod_reconciliation_cash_float_check;

alter table public.eod_reconciliation
  add constraint eod_reconciliation_cash_float_check
  check (opening_cash_float >= 0 and closing_cash_float >= 0);

update public.eod_reconciliation reconciliation
set
  opening_cash_float = settings.till_opening_float,
  closing_cash_float = settings.till_closing_float
from public.store_settings settings
where settings.store_key = reconciliation.store_key
  and reconciliation.opening_cash_float = 0
  and reconciliation.closing_cash_float = 0
  and settings.till_opening_float = settings.till_closing_float;

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

  update public.eod_reconciliation reconciliation
  set
    opening_cash_float = round(cash_opening_float, 2),
    closing_cash_float = round(cash_closing_float, 2),
    total_expected_cash = round(cash_total_expected, 2),
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
