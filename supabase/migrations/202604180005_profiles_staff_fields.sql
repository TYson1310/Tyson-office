alter table public.profiles
  add column if not exists phone text,
  add column if not exists monthly_salary numeric(12, 2) not null default 0;
