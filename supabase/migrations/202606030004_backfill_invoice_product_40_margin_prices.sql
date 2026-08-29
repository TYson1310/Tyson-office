-- Backfill selling prices for products already received through processed
-- vendor invoices. A 40% gross margin means price = cost / 0.60.
with latest_invoice_receipts as (
  select distinct on (movement.store_key, movement.product_id)
    movement.store_key,
    movement.product_id,
    round(movement.unit_cost, 2) as unit_cost,
    round(movement.unit_cost / 0.60, 2) as selling_price
  from public.inventory_movements as movement
  where movement.movement_type = 'vendor_invoice_receipt'
    and movement.vendor_invoice_id is not null
    and movement.product_id is not null
    and movement.quantity_delta > 0
    and movement.unit_cost > 0
  order by
    movement.store_key,
    movement.product_id,
    movement.created_at desc,
    movement.id desc
)
update public.products as product
set
  cost = latest_invoice_receipts.unit_cost,
  price = latest_invoice_receipts.selling_price,
  target_margin_percent = 40
from latest_invoice_receipts
where product.store_key = latest_invoice_receipts.store_key
  and product.id = latest_invoice_receipts.product_id
  and (
    product.cost is distinct from latest_invoice_receipts.unit_cost
    or product.price is distinct from latest_invoice_receipts.selling_price
    or product.target_margin_percent is distinct from 40
  );
