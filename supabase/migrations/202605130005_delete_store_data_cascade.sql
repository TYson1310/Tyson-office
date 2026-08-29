create or replace function public.delete_store_and_data(target_store_key text)
returns table (
  deleted_store_key text,
  deleted_table_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  delete_progress boolean;
  delete_queue_row record;
  deleted_tables integer := 0;
  pass_count integer := 0;
begin
  if target_store_key is null or btrim(target_store_key) = '' then
    raise exception 'Store key is required'
      using errcode = '22023';
  end if;

  if target_store_key = 'default' then
    raise exception 'Default store cannot be deleted'
      using errcode = '22023';
  end if;

  perform 1
  from public.stores
  where public.stores.store_key = target_store_key
  for update;

  if not found then
    raise exception 'Store % was not found', target_store_key
      using errcode = 'P0002';
  end if;

  drop table if exists pg_temp.store_data_delete_queue;
  create temporary table store_data_delete_queue (
    schema_name name not null,
    table_name name not null,
    primary key (schema_name, table_name)
  ) on commit drop;

  insert into pg_temp.store_data_delete_queue (schema_name, table_name)
  select
    namespace.nspname,
    relation.relname
  from pg_catalog.pg_attribute attribute
  join pg_catalog.pg_class relation
    on relation.oid = attribute.attrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind in ('r', 'p')
    and attribute.attname = 'store_key'
    and not attribute.attisdropped
    and relation.relname <> 'stores'
  order by relation.relname;

  loop
    delete_progress := false;
    pass_count := pass_count + 1;

    for delete_queue_row in
      select schema_name, table_name
      from pg_temp.store_data_delete_queue
      order by table_name
    loop
      begin
        execute format(
          'delete from %I.%I where store_key = $1',
          delete_queue_row.schema_name,
          delete_queue_row.table_name
        )
        using target_store_key;

        delete from pg_temp.store_data_delete_queue
        where schema_name = delete_queue_row.schema_name
          and table_name = delete_queue_row.table_name;

        deleted_tables := deleted_tables + 1;
        delete_progress := true;
      exception
        when foreign_key_violation then
          null;
      end;
    end loop;

    exit when not exists (
      select 1
      from pg_temp.store_data_delete_queue
    );

    if not delete_progress or pass_count > 100 then
      raise exception 'Could not delete every store-scoped table for store %', target_store_key
        using errcode = '23503';
    end if;
  end loop;

  delete from public.stores
  where public.stores.store_key = target_store_key;

  if not found then
    raise exception 'Store % was not found', target_store_key
      using errcode = 'P0002';
  end if;

  return query
  select target_store_key, deleted_tables;
end;
$$;

revoke execute on function public.delete_store_and_data(text) from public;
grant execute on function public.delete_store_and_data(text) to service_role;
