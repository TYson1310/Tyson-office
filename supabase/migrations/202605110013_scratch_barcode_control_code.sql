alter table public.inventory
  add column if not exists received_ticket_number text,
  add column if not exists pack_control_code text,
  add column if not exists pack_ticket_count integer;

alter table public.game_catalog
  add column if not exists ticket_count integer;

update public.inventory
set received_ticket_number = regexp_replace(
  pack_id,
  '^([0-9]{5})-([0-9]{6})-([0-9]{3}).*$',
  '\3'
)
where received_ticket_number is null
  and pack_id ~ '^([0-9]{5})-([0-9]{6})-([0-9]{3})';

alter table public.inventory
  drop constraint if exists inventory_received_ticket_number_format,
  drop constraint if exists inventory_pack_control_code_format,
  drop constraint if exists inventory_pack_ticket_count_range,
  drop constraint if exists inventory_pack_ticket_count_positive,
  drop constraint if exists inventory_pack_ticket_count_matches_control;

alter table public.inventory
  add constraint inventory_received_ticket_number_format check (
    received_ticket_number is null
    or received_ticket_number ~ '^[0-9]{3}$'
  ),
  add constraint inventory_pack_control_code_format check (
    pack_control_code is null
    or pack_control_code ~ '^[0-9]{3}$'
  ),
  add constraint inventory_pack_ticket_count_range check (
    pack_ticket_count is null
    or pack_ticket_count between 1 and 1000
  ),
  add constraint inventory_pack_ticket_count_matches_control check (
    case
      when pack_ticket_count is not null
        and received_ticket_number ~ '^[0-9]{3}$'
        and pack_control_code ~ '^[0-9]{3}$'
      then pack_ticket_count = (
        received_ticket_number::integer + pack_control_code::integer
      )
      else true
    end
  );

alter table public.game_catalog
  drop constraint if exists game_catalog_ticket_count_range,
  drop constraint if exists game_catalog_ticket_count_positive;

alter table public.game_catalog
  add constraint game_catalog_ticket_count_range check (
    ticket_count is null
    or ticket_count between 1 and 1000
  );

with ticket_count_samples as (
  select
    inventory_row.game_id,
    inventory_row.pack_ticket_count,
    count(*) as sample_count
  from public.inventory inventory_row
  where inventory_row.pack_ticket_count is not null
  group by inventory_row.game_id, inventory_row.pack_ticket_count
),
ranked_ticket_counts as (
  select
    ticket_count_samples.game_id,
    ticket_count_samples.pack_ticket_count,
    row_number() over (
      partition by ticket_count_samples.game_id
      order by ticket_count_samples.sample_count desc,
        ticket_count_samples.pack_ticket_count desc
    ) as ticket_count_rank
  from ticket_count_samples
)
update public.game_catalog game
set ticket_count = ranked_ticket_counts.pack_ticket_count
from ranked_ticket_counts
where ranked_ticket_counts.game_id = game.game_id
  and ranked_ticket_counts.ticket_count_rank = 1
  and game.ticket_count is null;

drop function if exists public.receive_scratch_pack(text, text);

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
  parsed_pack_ticket_count integer;
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
  parsed_pack_ticket_count := case
    when parsed_control_code is null then null
    else parsed_ticket_number::integer + parsed_control_code::integer
  end;

  if parsed_pack_ticket_count is not null
    and parsed_pack_ticket_count > 1000
  then
    raise exception 'Invalid barcode read. Ticket count % is too high', parsed_pack_ticket_count
      using errcode = '22023';
  end if;

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
  where game.game_id = parsed_game_id
  for update;

  if not found then
    raise exception 'Game % was not found in game_catalog', parsed_game_id
      using errcode = 'P0002';
  end if;

  if parsed_pack_ticket_count is not null then
    if known_ticket_count is not null
      and known_ticket_count <> parsed_pack_ticket_count
    then
      raise exception 'Barcode ticket count % does not match game % ticket count %',
        parsed_pack_ticket_count,
        parsed_game_id,
        known_ticket_count
        using errcode = '22023';
    end if;

    update public.game_catalog
    set ticket_count = parsed_pack_ticket_count
    where game_id = parsed_game_id
      and ticket_count is null;
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
    parsed_pack_ticket_count,
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
