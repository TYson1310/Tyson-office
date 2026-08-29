alter table public.pay_statements
  add column if not exists payment_method text not null default 'direct_deposit';

alter table public.pay_statements
  drop constraint if exists pay_statements_payment_method_check;

alter table public.pay_statements
  add constraint pay_statements_payment_method_check
  check (
    payment_method in (
      'direct_deposit',
      'check',
      'cash',
      'bank_transfer',
      'payroll_card',
      'other'
    )
  );

create index if not exists pay_statements_store_key_payment_method_idx
  on public.pay_statements (store_key, payment_method, pay_date desc);

alter table public.store_settings
  add column if not exists till_opening_float numeric(12, 2) not null default 500;

alter table public.store_settings
  add column if not exists till_closing_float numeric(12, 2) not null default 500;

alter table public.store_settings
  drop constraint if exists store_settings_till_opening_float_check;

alter table public.store_settings
  add constraint store_settings_till_opening_float_check
  check (till_opening_float >= 0);

alter table public.store_settings
  drop constraint if exists store_settings_till_closing_float_check;

alter table public.store_settings
  add constraint store_settings_till_closing_float_check
  check (till_closing_float >= 0);
