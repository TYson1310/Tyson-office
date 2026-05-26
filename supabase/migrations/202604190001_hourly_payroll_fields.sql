alter table public.profiles
  add column if not exists hourly_rate numeric(12, 2) not null default 0;

alter table public.pay_statements
  add column if not exists regular_hours numeric(8, 2) not null default 0,
  add column if not exists hourly_rate numeric(12, 2) not null default 0,
  add column if not exists overtime_multiplier numeric(4, 2) not null default 1.5;
