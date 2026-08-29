create table if not exists public.shift_time_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  entry_date date not null,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  hours_worked numeric(8, 2) not null default 0,
  entry_type text not null check (entry_type in ('automatic', 'manual')),
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint shift_time_entries_clock_sequence
    check (clock_out_at is null or clock_out_at >= clock_in_at),
  constraint shift_time_entries_non_negative_hours
    check (hours_worked >= 0)
);

drop trigger if exists shift_time_entries_set_updated_at on public.shift_time_entries;
create trigger shift_time_entries_set_updated_at
before update on public.shift_time_entries
for each row
execute function public.set_updated_at();

create index if not exists shift_time_entries_employee_id_entry_date_idx
  on public.shift_time_entries (employee_id, entry_date desc, clock_in_at desc);

create index if not exists shift_time_entries_entry_date_clock_in_at_idx
  on public.shift_time_entries (entry_date desc, clock_in_at desc);

create unique index if not exists shift_time_entries_open_shift_unique_idx
  on public.shift_time_entries (employee_id)
  where clock_out_at is null;

alter table public.shift_time_entries enable row level security;

create policy "shift_time_entries_select_own_or_admin"
on public.shift_time_entries
for select
to authenticated
using (
  employee_id = (select auth.uid())
  or (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);

create policy "shift_time_entries_manage_admin"
on public.shift_time_entries
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager'])))
with check ((select public.is_current_user_role(array['admin', 'manager'])));
