create or replace function public.receive_scratch_pack(
  target_store_key text,
  scanned_barcode text
)
returns table (
  id uuid,
  store_key text,
  pack_number text,
  game_id text,
  status public.scratch_pack_status,
  bin_number integer,
  ticket_number text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  barcode_matches text[];
  parsed_game_id text;
  parsed_pack_number text;
  parsed_ticket_number text;
begin
  if not (
    select public.can_access_store(
      target_store_key,
      array['admin', 'manager', 'cashier', 'employee']
    )
  ) then
    raise exception 'Forbidden: receiving scratch packs is not available for this store'
      using errcode = '42501';
  end if;

  barcode_matches := regexp_match(
    trim(coalesce(scanned_barcode, '')),
    '^([0-9]{5})-([0-9]{6})-([0-9]{3})$'
  );

  if barcode_matches is null then
    raise exception 'Invalid barcode format. Expected GGGGG-PPPPPP-TTT'
      using errcode = '22023';
  end if;

  parsed_game_id := barcode_matches[1];
  parsed_pack_number := barcode_matches[2];
  parsed_ticket_number := barcode_matches[3];

  if not exists (
    select 1
    from public.game_catalog game
    where game.game_id = parsed_game_id
  ) then
    raise exception 'Game % was not found in game_catalog', parsed_game_id
      using errcode = 'P0002';
  end if;

  return query
  insert into public.inventory (
    store_key,
    pack_number,
    game_id,
    status,
    bin_number
  )
  values (
    target_store_key,
    parsed_pack_number,
    parsed_game_id,
    'in_backstock',
    null
  )
  returning
    public.inventory.id,
    public.inventory.store_key,
    public.inventory.pack_number,
    public.inventory.game_id,
    public.inventory.status,
    public.inventory.bin_number,
    parsed_ticket_number,
    public.inventory.created_at;
exception
  when unique_violation then
    raise exception 'Pack % is already in inventory', parsed_pack_number
      using errcode = '23505';
end;
$$;

create or replace function public.load_scratch_pack_bin(
  target_store_key text,
  target_pack_number text,
  target_bin_number integer
)
returns table (
  loaded_inventory_id uuid,
  loaded_pack_number text,
  loaded_game_id text,
  loaded_bin_number integer,
  retired_inventory_id uuid,
  retired_pack_number text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_pack_number text;
  target_pack public.inventory%rowtype;
  retired_pack public.inventory%rowtype;
begin
  if not (select public.can_access_store(target_store_key, array['admin', 'manager'])) then
    raise exception 'Forbidden: loading scratch bins requires admin or manager access'
      using errcode = '42501';
  end if;

  normalized_pack_number := trim(coalesce(target_pack_number, ''));

  if normalized_pack_number !~ '^[0-9]{6}$' then
    raise exception 'Pack number must be 6 digits'
      using errcode = '22023';
  end if;

  if target_bin_number is null or target_bin_number <= 0 then
    raise exception 'Bin number must be a positive integer'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_store_key), target_bin_number);

  select inventory_row.*
  into target_pack
  from public.inventory inventory_row
  where inventory_row.store_key = target_store_key
    and inventory_row.pack_number = normalized_pack_number
  for update;

  if target_pack.id is null then
    raise exception 'Pack % was not found in backstock', normalized_pack_number
      using errcode = 'P0002';
  end if;

  if target_pack.status <> 'in_backstock' then
    raise exception 'Pack % is %, not in_backstock', normalized_pack_number, target_pack.status
      using errcode = '22023';
  end if;

  select inventory_row.*
  into retired_pack
  from public.inventory inventory_row
  where inventory_row.store_key = target_store_key
    and inventory_row.bin_number = target_bin_number
    and inventory_row.status = 'active'
    and inventory_row.id <> target_pack.id
  for update;

  if retired_pack.id is not null then
    update public.inventory
    set
      status = 'settled',
      bin_number = null
    where public.inventory.id = retired_pack.id;
  end if;

  update public.inventory
  set
    status = 'active',
    bin_number = target_bin_number
  where public.inventory.id = target_pack.id
  returning public.inventory.*
  into target_pack;

  return query
  select
    target_pack.id,
    target_pack.pack_number,
    target_pack.game_id,
    target_pack.bin_number,
    retired_pack.id,
    retired_pack.pack_number;
end;
$$;

create or replace function public.reconcile_scratch_bin(
  target_store_key text,
  target_bin_number integer,
  input_start_ticket_number text,
  input_end_ticket_number text,
  input_pos_sales_amount numeric,
  reconciled_by uuid default auth.uid()
)
returns table (
  audit_id uuid,
  inventory_id uuid,
  game_id text,
  pack_number text,
  bin_number integer,
  start_ticket_number text,
  end_ticket_number text,
  ticket_price numeric(10, 2),
  tickets_sold integer,
  expected_sales numeric(12, 2),
  pos_sales_amount numeric(12, 2),
  short_over numeric(12, 2),
  discrepancy_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  active_pack record;
  start_ticket_value integer;
  end_ticket_value integer;
  normalized_start_ticket text;
  normalized_end_ticket text;
  normalized_pos_sales numeric(12, 2);
  sold_ticket_count integer;
  expected_sales_total numeric(12, 2);
  short_over_total numeric(12, 2);
  audit_record_id uuid;
begin
  if not (
    select public.can_access_store(
      target_store_key,
      array['admin', 'manager', 'cashier', 'employee']
    )
  ) then
    raise exception 'Forbidden: scratch reconciliation is not available for this store'
      using errcode = '42501';
  end if;

  if reconciled_by is null then
    raise exception 'An authenticated employee is required for reconciliation'
      using errcode = '42501';
  end if;

  if target_bin_number is null or target_bin_number <= 0 then
    raise exception 'Bin number must be a positive integer'
      using errcode = '22023';
  end if;

  if trim(coalesce(input_start_ticket_number, '')) !~ '^[0-9]{1,3}$' then
    raise exception 'Start ticket number must be 1 to 3 digits'
      using errcode = '22023';
  end if;

  if trim(coalesce(input_end_ticket_number, '')) !~ '^[0-9]{1,3}$' then
    raise exception 'End ticket number must be 1 to 3 digits'
      using errcode = '22023';
  end if;

  if input_pos_sales_amount is null or input_pos_sales_amount < 0 then
    raise exception 'POS sales amount must be zero or greater'
      using errcode = '22023';
  end if;

  start_ticket_value := trim(input_start_ticket_number)::integer;
  end_ticket_value := trim(input_end_ticket_number)::integer;
  normalized_start_ticket := lpad(start_ticket_value::text, 3, '0');
  normalized_end_ticket := lpad(end_ticket_value::text, 3, '0');
  normalized_pos_sales := round(input_pos_sales_amount, 2);

  select
    inventory_row.id as inventory_id,
    inventory_row.game_id,
    inventory_row.pack_number,
    inventory_row.bin_number,
    game.ticket_price
  into active_pack
  from public.inventory inventory_row
  join public.game_catalog game
    on game.game_id = inventory_row.game_id
  where inventory_row.store_key = target_store_key
    and inventory_row.bin_number = target_bin_number
    and inventory_row.status = 'active'
  for update of inventory_row;

  if active_pack.inventory_id is null then
    raise exception 'No active scratch pack was found in bin %', target_bin_number
      using errcode = 'P0002';
  end if;

  sold_ticket_count := abs(end_ticket_value - start_ticket_value);
  expected_sales_total := round(
    (sold_ticket_count * active_pack.ticket_price)::numeric,
    2
  );
  short_over_total := normalized_pos_sales - expected_sales_total;

  insert into public.audits (
    store_key,
    employee_id,
    inventory_id,
    bin_number,
    ticket_number_scanned,
    calculated_sales
  )
  values (
    target_store_key,
    reconciled_by,
    active_pack.inventory_id,
    target_bin_number,
    normalized_end_ticket,
    expected_sales_total
  )
  returning id
  into audit_record_id;

  return query
  select
    audit_record_id,
    active_pack.inventory_id,
    active_pack.game_id,
    active_pack.pack_number,
    active_pack.bin_number,
    normalized_start_ticket,
    normalized_end_ticket,
    active_pack.ticket_price,
    sold_ticket_count,
    expected_sales_total,
    normalized_pos_sales,
    short_over_total,
    case
      when short_over_total < 0 then 'short'
      when short_over_total > 0 then 'over'
      else 'balanced'
    end;
end;
$$;
