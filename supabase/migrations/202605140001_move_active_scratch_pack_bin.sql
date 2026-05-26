create or replace function public.move_active_scratch_pack_bin(
  target_store_key text,
  input_source_bin_number integer,
  input_target_bin_number integer,
  moved_by uuid default auth.uid()
)
returns table (
  mode text,
  source_bin_number integer,
  target_bin_number integer,
  moved_inventory_id uuid,
  moved_pack_number text,
  moved_game_id text,
  moved_from_bin_number integer,
  moved_to_bin_number integer,
  swapped_inventory_id uuid,
  swapped_pack_number text,
  swapped_game_id text,
  swapped_from_bin_number integer,
  swapped_to_bin_number integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  configured_bin_count integer;
  source_pack public.inventory%rowtype;
  target_pack public.inventory%rowtype;
  temporary_bin_number integer;
begin
  if moved_by is null then
    raise exception 'An authenticated manager is required to move scratch bins'
      using errcode = '42501';
  end if;

  if not (
    select public.can_access_store(target_store_key, array['admin', 'manager'])
  ) then
    raise exception 'Forbidden: moving scratch bins requires admin or manager access'
      using errcode = '42501';
  end if;

  if input_source_bin_number is null or input_source_bin_number <= 0 then
    raise exception 'Source bin number must be a positive integer'
      using errcode = '22023';
  end if;

  if input_target_bin_number is null or input_target_bin_number <= 0 then
    raise exception 'Target bin number must be a positive integer'
      using errcode = '22023';
  end if;

  if input_source_bin_number = input_target_bin_number then
    raise exception 'Choose a different bin before moving the pack'
      using errcode = '22023';
  end if;

  select store_settings.scratch_bin_count
  into configured_bin_count
  from public.store_settings
  where store_settings.store_key = target_store_key;

  if configured_bin_count is not null
    and input_target_bin_number > configured_bin_count then
    raise exception 'Target bin % is outside the configured scratch bins',
      input_target_bin_number
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(target_store_key),
    least(input_source_bin_number, input_target_bin_number)
  );
  perform pg_advisory_xact_lock(
    hashtext(target_store_key),
    greatest(input_source_bin_number, input_target_bin_number)
  );

  select inventory_row.*
  into source_pack
  from public.inventory inventory_row
  where inventory_row.store_key = target_store_key
    and inventory_row.status = 'active'
    and inventory_row.bin_number = input_source_bin_number
  for update;

  if source_pack.id is null then
    raise exception 'No active pack is loaded in bin %', input_source_bin_number
      using errcode = 'P0002';
  end if;

  select inventory_row.*
  into target_pack
  from public.inventory inventory_row
  where inventory_row.store_key = target_store_key
    and inventory_row.status = 'active'
    and inventory_row.bin_number = input_target_bin_number
  for update;

  if target_pack.id is null then
    update public.inventory
    set bin_number = input_target_bin_number
    where public.inventory.id = source_pack.id;

    return query
    select
      'moved'::text,
      input_source_bin_number,
      input_target_bin_number,
      source_pack.id,
      source_pack.pack_number,
      source_pack.game_id,
      input_source_bin_number,
      input_target_bin_number,
      null::uuid,
      null::text,
      null::text,
      null::integer,
      null::integer;

    return;
  end if;

  select coalesce(max(inventory_row.bin_number), 0) + 1000
  into temporary_bin_number
  from public.inventory inventory_row
  where inventory_row.store_key = target_store_key
    and inventory_row.status = 'active';

  while exists (
    select 1
    from public.inventory inventory_row
    where inventory_row.store_key = target_store_key
      and inventory_row.status = 'active'
      and inventory_row.bin_number = temporary_bin_number
  ) loop
    temporary_bin_number := temporary_bin_number + 1;
  end loop;

  update public.inventory
  set bin_number = temporary_bin_number
  where public.inventory.id = source_pack.id;

  update public.inventory
  set bin_number = input_source_bin_number
  where public.inventory.id = target_pack.id;

  update public.inventory
  set bin_number = input_target_bin_number
  where public.inventory.id = source_pack.id;

  return query
  select
    'swapped'::text,
    input_source_bin_number,
    input_target_bin_number,
    source_pack.id,
    source_pack.pack_number,
    source_pack.game_id,
    input_source_bin_number,
    input_target_bin_number,
    target_pack.id,
    target_pack.pack_number,
    target_pack.game_id,
    input_target_bin_number,
    input_source_bin_number;
end;
$$;

revoke execute on function public.move_active_scratch_pack_bin(
  text,
  integer,
  integer,
  uuid
) from public;

grant execute on function public.move_active_scratch_pack_bin(
  text,
  integer,
  integer,
  uuid
) to authenticated;
