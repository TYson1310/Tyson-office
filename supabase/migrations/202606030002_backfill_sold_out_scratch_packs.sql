update public.inventory inventory_row
set status = 'sold_out',
    updated_at = timezone('utc', now())
from public.game_catalog game
where inventory_row.game_id = game.game_id
  and inventory_row.status = 'active'
  and coalesce(inventory_row.pack_ticket_count, game.ticket_count) is not null
  and exists (
    select 1
    from public.daily_audits audit
    where audit.store_key = inventory_row.store_key
      and audit.inventory_id = inventory_row.id
      and audit.end_ticket_no ~ '^[0-9]{1,3}$'
      and audit.end_ticket_no::integer >= coalesce(
        inventory_row.pack_ticket_count,
        game.ticket_count
      ) - 1
  );
