create table if not exists public.shift_schedules (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  shift_date date not null,
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz not null,
  unpaid_break_minutes integer not null default 0,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint shift_schedules_time_sequence
    check (scheduled_end_at > scheduled_start_at),
  constraint shift_schedules_break_minutes_non_negative
    check (unpaid_break_minutes >= 0)
);

drop trigger if exists shift_schedules_set_updated_at on public.shift_schedules;
create trigger shift_schedules_set_updated_at
before update on public.shift_schedules
for each row
execute function public.set_updated_at();

create unique index if not exists shift_schedules_store_employee_date_uidx
  on public.shift_schedules (store_key, employee_id, shift_date);

create index if not exists shift_schedules_store_date_idx
  on public.shift_schedules (store_key, shift_date asc, scheduled_start_at asc);

create index if not exists shift_schedules_employee_date_idx
  on public.shift_schedules (employee_id, shift_date desc);

alter table public.shift_time_entries
  add column if not exists schedule_id uuid references public.shift_schedules (id) on delete set null;

create index if not exists shift_time_entries_schedule_id_idx
  on public.shift_time_entries (schedule_id);

create table if not exists public.attendance_exceptions (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  shift_entry_id uuid references public.shift_time_entries (id) on delete set null,
  schedule_id uuid references public.shift_schedules (id) on delete set null,
  exception_date date not null,
  exception_type text not null
    check (
      exception_type in (
        'missed_clock_in',
        'missed_clock_out',
        'late_start',
        'early_finish',
        'overtime',
        'unscheduled_shift'
      )
    ),
  status text not null default 'open'
    check (status in ('open', 'resolved', 'ignored')),
  severity text not null
    check (severity in ('info', 'warning', 'critical')),
  title text not null,
  details text not null,
  resolution_notes text,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists attendance_exceptions_set_updated_at on public.attendance_exceptions;
create trigger attendance_exceptions_set_updated_at
before update on public.attendance_exceptions
for each row
execute function public.set_updated_at();

create unique index if not exists attendance_exceptions_unique_issue_uidx
  on public.attendance_exceptions (
    store_key,
    employee_id,
    exception_date,
    exception_type
  );

create index if not exists attendance_exceptions_store_status_idx
  on public.attendance_exceptions (store_key, status, exception_date desc, created_at desc);

create index if not exists attendance_exceptions_employee_date_idx
  on public.attendance_exceptions (employee_id, exception_date desc, created_at desc);

alter table public.shift_schedules enable row level security;
alter table public.attendance_exceptions enable row level security;

drop policy if exists "shift_schedules_select_own_or_admin" on public.shift_schedules;
create policy "shift_schedules_select_own_or_admin"
on public.shift_schedules
for select
to authenticated
using (
  employee_id = (select auth.uid())
  or (
    select public.can_access_store(
      store_key,
      array['admin', 'manager', 'accountant']
    )
  )
);

drop policy if exists "shift_schedules_manage_admin" on public.shift_schedules;
create policy "shift_schedules_manage_admin"
on public.shift_schedules
for all
to authenticated
using (
  (
    select public.can_access_store(
      store_key,
      array['admin', 'manager']
    )
  )
)
with check (
  (
    select public.can_access_store(
      store_key,
      array['admin', 'manager']
    )
  )
);

drop policy if exists "attendance_exceptions_select_own_or_admin" on public.attendance_exceptions;
create policy "attendance_exceptions_select_own_or_admin"
on public.attendance_exceptions
for select
to authenticated
using (
  employee_id = (select auth.uid())
  or (
    select public.can_access_store(
      store_key,
      array['admin', 'manager', 'accountant']
    )
  )
);

drop policy if exists "attendance_exceptions_manage_admin" on public.attendance_exceptions;
create policy "attendance_exceptions_manage_admin"
on public.attendance_exceptions
for all
to authenticated
using (
  (
    select public.can_access_store(
      store_key,
      array['admin', 'manager']
    )
  )
)
with check (
  (
    select public.can_access_store(
      store_key,
      array['admin', 'manager']
    )
  )
);
