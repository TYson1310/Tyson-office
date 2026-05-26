create extension if not exists btree_gist;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'shift_time_entries_employee_time_no_overlap'
  ) then
    alter table public.shift_time_entries
      drop constraint shift_time_entries_employee_time_no_overlap;
  end if;

  begin
    alter table public.shift_time_entries
      add constraint shift_time_entries_employee_time_no_overlap
      exclude using gist (
        employee_id with =,
        tstzrange(
          clock_in_at,
          coalesce(clock_out_at, 'infinity'::timestamptz),
          '[)'
        ) with &&
      )
      where (entry_type = 'manual');
  exception
    when duplicate_object then null;
  end;
end
$$;
