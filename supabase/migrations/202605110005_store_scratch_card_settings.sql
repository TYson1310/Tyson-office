alter table public.store_settings
  add column if not exists scratch_bin_count integer not null default 40;

alter table public.store_settings
  drop constraint if exists store_settings_scratch_bin_count_check;

alter table public.store_settings
  add constraint store_settings_scratch_bin_count_check
  check (scratch_bin_count between 1 and 200);
