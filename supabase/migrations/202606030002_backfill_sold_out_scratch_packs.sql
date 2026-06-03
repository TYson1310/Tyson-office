with latest_inventory_audit as (
  select distinct on (audit.inventory_id)
    audit.inventory_id,
    audit.end_ticket_no
  from public.daily_audits audit
  where audit.inventory_id is not null
    and audit.end_ticket_no ~ '^[0-9]{1,3}$'
  order by audit.inventory_id, audit.audit_date desc, audit.created_at desc
)
update public.inventory inventory_row
set status = 'sold_out',
    updated_at = timezone('utc', now())
from public.game_catalog game,
     latest_inventory_audit latest_audit
where inventory_row.game_id = game.game_id
  and latest_audit.inventory_id = inventory_row.id
  and inventory_row.status = 'active'
  and coalesce(inventory_row.pack_ticket_count, game.ticket_count) is not null
  and latest_audit.end_ticket_no::integer >= coalesce(
    inventory_row.pack_ticket_count,
    game.ticket_count
  ) - 1;
