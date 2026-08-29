alter table public.pay_statements
  add column if not exists pay_frequency text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pay_statements_pay_frequency_check'
  ) then
    alter table public.pay_statements
      add constraint pay_statements_pay_frequency_check
      check (pay_frequency is null or pay_frequency in ('weekly', 'monthly'));
  end if;
end
$$;

create index if not exists pay_statements_frequency_period_idx
  on public.pay_statements (pay_frequency, period_start, period_end);

create unique index if not exists pay_statements_employee_term_frequency_unique_idx
  on public.pay_statements (employee_id, pay_frequency, period_start, period_end)
  where pay_frequency is not null;
