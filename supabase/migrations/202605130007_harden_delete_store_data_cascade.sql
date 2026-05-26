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
  deleted_row_count integer;
  deleted_tables integer := 0;
  pass_count integer := 0;
  remaining_rows boolean;
  table_has_rows boolean;
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

  drop table if exists pg_temp.store_data_deleted_tables;
  create temporary table store_data_deleted_tables (
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

        get diagnostics deleted_row_count = row_count;

        if deleted_row_count > 0 then
          insert into pg_temp.store_data_deleted_tables (schema_name, table_name)
          values (delete_queue_row.schema_name, delete_queue_row.table_name)
          on conflict do nothing;

          delete_progress := true;
        end if;
      exception
        when foreign_key_violation then
          null;
      end;
    end loop;

    remaining_rows := false;

    for delete_queue_row in
      select schema_name, table_name
      from pg_temp.store_data_delete_queue
      order by table_name
    loop
      execute format(
        'select exists (select 1 from %I.%I where store_key = $1)',
        delete_queue_row.schema_name,
        delete_queue_row.table_name
      )
      into table_has_rows
      using target_store_key;

      if table_has_rows then
        remaining_rows := true;
        exit;
      end if;
    end loop;

    exit when not remaining_rows;

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

  select count(*)::integer
  into deleted_tables
  from pg_temp.store_data_deleted_tables;

  return query
  select target_store_key, deleted_tables;
end;
$$;

revoke execute on function public.delete_store_and_data(text) from public;
grant execute on function public.delete_store_and_data(text) to service_role;
