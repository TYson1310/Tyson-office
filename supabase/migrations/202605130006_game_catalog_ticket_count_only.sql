update public.inventory
set pack_ticket_count = null
where pack_ticket_count is not null;

alter table public.inventory
  drop constraint if exists inventory_pack_ticket_count_catalog_only;

alter table public.inventory
  add constraint inventory_pack_ticket_count_catalog_only
  check (pack_ticket_count is null);

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
  pack_control_code text,
  pack_ticket_count integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  barcode_matches text[];
  canonical_pack_id text;
  normalized_barcode text;
  normalized_digits text;
  known_ticket_count integer;
  parsed_control_code text;
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

  normalized_barcode := trim(coalesce(scanned_barcode, ''));
  barcode_matches := regexp_match(
    normalized_barcode,
    '^([0-9]{5})-([0-9]{6})-([0-9]{3})(\s*\(?([0-9]{3})\)?)?$'
  );

  if barcode_matches is null then
    normalized_digits := regexp_replace(normalized_barcode, '\D', '', 'g');
    barcode_matches := regexp_match(
      normalized_digits,
      '^([0-9]{5})([0-9]{6})([0-9]{3})([0-9]{3})?$'
    );
  end if;

  if barcode_matches is null then
    raise exception 'Invalid barcode format. Expected GGGGG-PPPPPP-TTT with optional check code'
      using errcode = '22023';
  end if;

  parsed_game_id := barcode_matches[1];
  parsed_pack_number := barcode_matches[2];
  parsed_ticket_number := barcode_matches[3];
  parsed_control_code := nullif(
    coalesce(barcode_matches[5], barcode_matches[4]),
    ''
  );
  canonical_pack_id := concat(
    parsed_game_id,
    '-',
    parsed_pack_number,
    '-',
    parsed_ticket_number
  );

  select game.ticket_count
  into known_ticket_count
  from public.game_catalog game
  where game.game_id = parsed_game_id;

  if not found then
    raise exception 'Game % was not found in game_catalog', parsed_game_id
      using errcode = 'P0002';
  end if;

  if known_ticket_count is null then
    raise exception 'Set tickets per pack for game % in the private admin game catalog before receiving packs',
      parsed_game_id
      using errcode = '22023';
  end if;

  return query
  insert into public.inventory (
    pack_id,
    store_key,
    pack_number,
    game_id,
    status,
    bin_number,
    received_ticket_number,
    pack_control_code,
    pack_ticket_count,
    date_received
  )
  values (
    canonical_pack_id,
    target_store_key,
    parsed_pack_number,
    parsed_game_id,
    'backstock',
    null,
    parsed_ticket_number,
    parsed_control_code,
    null,
    timezone('utc', now())
  )
  returning
    public.inventory.id,
    public.inventory.store_key,
    public.inventory.pack_number,
    public.inventory.game_id,
    public.inventory.status,
    public.inventory.bin_number,
    public.inventory.received_ticket_number,
    public.inventory.pack_control_code,
    public.inventory.pack_ticket_count,
    public.inventory.created_at;
exception
  when unique_violation then
    raise exception 'Pack % is already in inventory', parsed_pack_number
      using errcode = '23505';
end;
$$;

revoke execute on function public.receive_scratch_pack(text, text) from public;
grant execute on function public.receive_scratch_pack(text, text) to authenticated;
