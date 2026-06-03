do $$
begin
  if not exists (
    select 1
    from pg_enum enum_value
    join pg_type enum_type on enum_type.oid = enum_value.enumtypid
    where enum_type.typname = 'scratch_pack_status'
      and enum_type.typnamespace = 'public'::regnamespace
      and enum_value.enumlabel = 'sold_out'
  ) then
    alter type public.scratch_pack_status add value 'sold_out';
  end if;
end $$;
