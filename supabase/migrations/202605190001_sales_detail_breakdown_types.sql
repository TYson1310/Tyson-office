alter table public.store_settings
alter column product_types set default '[
  {"id":"net_sale","label":"Net Sale","description":"Sales before tax and fees","color":"#16a34a","enabled":true},
  {"id":"tax","label":"Tax","description":"Sales tax collected","color":"#f59e0b","enabled":true},
  {"id":"card_charge","label":"Card Charge","description":"Card processor or terminal charges","color":"#2563eb","enabled":true},
  {"id":"other_fees","label":"Other Fees","description":"Other daily charges and fees","color":"#9333ea","enabled":true}
]'::jsonb;

update public.store_settings
set product_types = '[
  {"id":"net_sale","label":"Net Sale","description":"Sales before tax and fees","color":"#16a34a","enabled":true},
  {"id":"tax","label":"Tax","description":"Sales tax collected","color":"#f59e0b","enabled":true},
  {"id":"card_charge","label":"Card Charge","description":"Card processor or terminal charges","color":"#2563eb","enabled":true},
  {"id":"other_fees","label":"Other Fees","description":"Other daily charges and fees","color":"#9333ea","enabled":true}
]'::jsonb
where jsonb_typeof(product_types) = 'array'
  and jsonb_array_length(product_types) = 6
  and product_types @> '[
    {"id":"groceries"},
    {"id":"electronics"},
    {"id":"apparel"},
    {"id":"home_care"},
    {"id":"beverages"},
    {"id":"other"}
  ]'::jsonb;
