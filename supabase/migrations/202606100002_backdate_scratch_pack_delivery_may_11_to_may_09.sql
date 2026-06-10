update public.inventory inventory_row
set date_received = timestamp with time zone '2026-05-09 12:00:00+00'
where inventory_row.date_received >= timestamp with time zone '2026-05-11 00:00:00+00'
  and inventory_row.date_received < timestamp with time zone '2026-05-12 00:00:00+00'
  and exists (
    select 1
    from public.game_catalog game
    where game.game_id = inventory_row.game_id
  );
