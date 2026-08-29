-- Add invoice 4923408 to default store vendor invoices.

begin;

with existing_supplier as (
  select id
  from public.suppliers
  where store_key = 'default'
    and (
      lower(name) = 'resnick distributors'
      or lower(name) like '%resnick%'
    )
  order by case when lower(name) = 'resnick distributors' then 0 else 1 end, created_at asc
  limit 1
), inserted_supplier as (
  insert into public.suppliers (
    store_key,
    name,
    phone,
    address,
    payment_terms,
    status
  )
  select
    'default',
    'Resnick Distributors',
    '(800) 828-3865',
    '25 Van Dyke Avenue, New Brunswick, NJ 08901',
    'net30',
    'active'
  where not exists (select 1 from existing_supplier)
  returning id
), target_supplier as (
  select id from existing_supplier
  union all
  select id from inserted_supplier
  limit 1
)
insert into public.vendor_invoices (
  store_key,
  supplier_id,
  invoice_number,
  amount,
  currency,
  issue_date,
  due_date,
  description,
  notes,
  status,
  paid_amount,
  pdf_url,
  pdf_path,
  pdf_file_name,
  pdf_mime_type
)
select
  'default',
  target_supplier.id,
  '4923408',
  2439.90,
  'USD',
  date '2026-06-23',
  date '2026-06-30',
  'Resnick Distributors invoice 4923408 (manifest 5950217, order 59876).',
  $$Imported from manual JSON payload on 2026-07-08.

vendor_name: Resnick Distributors
customer_number: 190797
order_number: 59876
manifest_number: 5950217
dr_number: 26062321201
terms: NET 7 DAYS
truck: 0 212 3
sales_tax_exempt_number: 41252007
cigarette_license_number: IN PROCESS

totals:
- quantity: 84
- cost: 2523.90
- allowance: -2.00
- net_cost: 2521.90
- retail_total: 2904.27
- excise_tax: 32.60
- total_promotion: -2.00
- pay_this_amount: 2439.90

discounts:
- volume_discount: -82.00
- breakdown:
  - group 0021 qty 13 discount -65.00
  - group 0022 qty 1 discount -5.00
  - group 0024 qty 4 discount -12.00

out_of_stock_items:
- UGLIES KETTLE BUFFALO RNCH 2Z (00785654261815)
- CHEEZ-IT SMOKED CHEDDAR 3Z (024100124916), expected 2026-07-06$$,
  'pending',
  0,
  null,
  null,
  null,
  null
from target_supplier
on conflict (store_key, invoice_number)
do update
set
  supplier_id = excluded.supplier_id,
  amount = excluded.amount,
  currency = excluded.currency,
  issue_date = excluded.issue_date,
  due_date = excluded.due_date,
  description = excluded.description,
  notes = excluded.notes,
  status = excluded.status,
  paid_amount = excluded.paid_amount,
  updated_at = timezone('utc', now());

commit;
