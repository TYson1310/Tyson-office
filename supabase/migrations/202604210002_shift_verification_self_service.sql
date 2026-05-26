alter table public.shift_time_entries
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.profiles (id) on delete set null;

update public.shift_time_entries
set verified_at = coalesce(verified_at, updated_at, created_at),
    verified_by = coalesce(verified_by, updated_by, created_by)
where entry_type = 'manual'
  and verified_at is null;

create index if not exists shift_time_entries_verification_idx
  on public.shift_time_entries (store_key, entry_type, verified_at, entry_date desc);

drop policy if exists "shift_time_entries_insert_own_automatic" on public.shift_time_entries;
create policy "shift_time_entries_insert_own_automatic"
on public.shift_time_entries
for insert
to authenticated
with check (
  employee_id = (select auth.uid())
  and entry_type = 'automatic'
  and clock_out_at is null
  and hours_worked = 0
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and verified_at is null
  and verified_by is null
  and (
    select public.can_access_store(
      store_key,
      array['manager', 'accountant', 'cashier', 'warehouse', 'employee']
    )
  )
);

drop policy if exists "shift_time_entries_update_own_automatic" on public.shift_time_entries;
create policy "shift_time_entries_update_own_automatic"
on public.shift_time_entries
for update
to authenticated
using (
  employee_id = (select auth.uid())
  and entry_type = 'automatic'
  and clock_out_at is null
  and (
    select public.can_access_store(
      store_key,
      array['manager', 'accountant', 'cashier', 'warehouse', 'employee']
    )
  )
)
with check (
  employee_id = (select auth.uid())
  and entry_type = 'automatic'
  and clock_out_at is not null
  and updated_by = (select auth.uid())
  and verified_at is null
  and verified_by is null
  and (
    select public.can_access_store(
      store_key,
      array['manager', 'accountant', 'cashier', 'warehouse', 'employee']
    )
  )
);
