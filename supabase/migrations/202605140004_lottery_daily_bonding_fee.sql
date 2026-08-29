alter table public.terminal_reports
  add column if not exists lottery_bonding_fee numeric(12, 2) not null default 0;

alter table public.terminal_report_revisions
  add column if not exists lottery_bonding_fee numeric(12, 2) not null default 0;

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
    and lottery_bonding_fee >= 0
  );

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
    lottery_bonding_fee,
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
    old.lottery_bonding_fee,
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
