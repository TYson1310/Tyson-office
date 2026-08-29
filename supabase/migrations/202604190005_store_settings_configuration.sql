create table if not exists public.store_settings (
  store_key text primary key default 'default' check (store_key = 'default'),
  business_name text not null default 'Default Store',
  business_email text,
  business_phone text,
  currency_code text not null default 'USD',
  timezone_name text not null default 'America/New_York',
  address_line_1 text,
  address_line_2 text,
  city text,
  state_region text,
  postal_code text,
  country text not null default 'United States',
  payment_methods jsonb not null default '[
    {"id":"cash","label":"Cash","description":"Bills and coins collected in the drawer","color":"#16a34a","enabled":true,"countsTowardCash":true},
    {"id":"card","label":"Card","description":"Card terminal settlements","color":"#2563eb","enabled":true,"countsTowardCash":false},
    {"id":"mobile","label":"Mobile Money","description":"Wallet and mobile transfer receipts","color":"#7c3aed","enabled":true,"countsTowardCash":false},
    {"id":"bank_transfer","label":"Bank Transfer","description":"Direct bank or ACH payments","color":"#0891b2","enabled":true,"countsTowardCash":false},
    {"id":"check","label":"Check","description":"Paper checks collected in store","color":"#ea580c","enabled":false,"countsTowardCash":false},
    {"id":"other","label":"Other","description":"Fallback tender type","color":"#475569","enabled":true,"countsTowardCash":false}
  ]'::jsonb,
  product_types jsonb not null default '[
    {"id":"groceries","label":"Groceries","description":"Staples, produce, and pantry items","color":"#16a34a","enabled":true},
    {"id":"electronics","label":"Electronics","description":"Devices, accessories, and cables","color":"#2563eb","enabled":true},
    {"id":"apparel","label":"Apparel","description":"Clothing and wearable goods","color":"#9333ea","enabled":true},
    {"id":"home_care","label":"Home Care","description":"Cleaning and household products","color":"#ea580c","enabled":true},
    {"id":"beverages","label":"Beverages","description":"Soft drinks, juices, and bottled water","color":"#0891b2","enabled":true},
    {"id":"other","label":"Other","description":"Fallback category for unmatched product totals","color":"#475569","enabled":true}
  ]'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint store_settings_payment_methods_array check (jsonb_typeof(payment_methods) = 'array'),
  constraint store_settings_product_types_array check (jsonb_typeof(product_types) = 'array')
);

drop trigger if exists store_settings_set_updated_at on public.store_settings;
create trigger store_settings_set_updated_at
before update on public.store_settings
for each row
execute function public.set_updated_at();

insert into public.store_settings (store_key)
values ('default')
on conflict (store_key) do nothing;

alter table public.store_settings enable row level security;

create policy "store_settings_select_authenticated"
on public.store_settings
for select
to authenticated
using (true);

create policy "store_settings_manage_admin"
on public.store_settings
for all
to authenticated
using ((select public.is_current_user_role(array['admin'])))
with check ((select public.is_current_user_role(array['admin'])));

alter table public.daily_sales_entries
drop constraint if exists daily_sales_entries_payment_method_check;

alter table public.daily_sales_entries
add constraint daily_sales_entries_payment_method_check
check (char_length(trim(payment_method)) > 0);
