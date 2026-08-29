do $$
declare
  duplicate_game record;
begin
  select
    store_key,
    game_id,
    array_agg(bin_number order by bin_number) as bins
  into duplicate_game
  from public.inventory
  where status = 'active'
    and bin_number is not null
  group by store_key, game_id
  having count(*) > 1
  limit 1;

  if found then
    raise exception 'Duplicate active scratch game % exists for store % in bins %. Resolve it before applying duplicate-game validation.',
      duplicate_game.game_id,
      duplicate_game.store_key,
      duplicate_game.bins
      using errcode = '23505';
  end if;
end $$;

create unique index if not exists inventory_one_active_game_per_store_idx
on public.inventory (store_key, game_id)
where status = 'active' and bin_number is not null;
