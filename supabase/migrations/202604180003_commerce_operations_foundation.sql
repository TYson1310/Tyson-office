create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique,
  phone text,
  address text,
  city text,
  postal_code text,
  country text default 'USA',
  credit_limit numeric(12, 2),
  loyalty_points integer not null default 0,
  segment text not null default 'regular' check (segment in ('regular', 'vip', 'wholesale')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row
execute function public.set_updated_at();

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  email text unique,
  phone text,
  address text,
  city text,
  postal_code text,
  country text default 'USA',
  category text,
  payment_terms text not null default 'net30' check (payment_terms in ('net30', 'net60', 'net90', 'cod', 'prepaid')),
  account_number text,
  status text not null default 'active' check (status in ('active', 'inactive', 'blacklisted')),
  rating numeric(4, 2) not null default 0,
  reliability_percent numeric(5, 2) not null default 0,
  lead_time_days integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at
before update on public.suppliers
for each row
execute function public.set_updated_at();

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers (id) on delete set null,
  name text not null,
  description text,
  sku text not null unique,
  category text not null,
  price numeric(12, 2) not null default 0,
  cost numeric(12, 2) not null default 0,
  quantity integer not null default 0,
  reorder_level integer not null default 0,
  location text,
  daily_velocity numeric(8, 2) not null default 0,
  target_margin_percent numeric(5, 2) not null default 35,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row
execute function public.set_updated_at();

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid references public.customers (id) on delete set null,
  channel text not null default 'In-store',
  item_count integer not null default 0,
  subtotal numeric(12, 2) not null default 0,
  tax numeric(12, 2) not null default 0,
  discount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  payment_status text not null default 'Pending' check (payment_status in ('Paid', 'Pending', 'Overdue')),
  fulfillment_status text not null default 'Picking' check (fulfillment_status in ('Ready', 'Picking', 'Packed', 'Delivered')),
  payment_method text check (payment_method in ('cash', 'card', 'mobile', 'bank_transfer', 'check', 'other')),
  promised_date date,
  created_by uuid references public.profiles (id) on delete set null,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists sales_orders_set_updated_at on public.sales_orders;
create trigger sales_orders_set_updated_at
before update on public.sales_orders
for each row
execute function public.set_updated_at();

create table if not exists public.sales_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sales_orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  description text,
  quantity integer not null default 1,
  unit_price numeric(12, 2) not null default 0,
  discount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  line_count integer not null default 0,
  amount numeric(12, 2) not null default 0,
  eta date,
  status text not null default 'Open' check (status in ('Open', 'Approved', 'Delayed', 'Received')),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists purchase_orders_set_updated_at on public.purchase_orders;
create trigger purchase_orders_set_updated_at
before update on public.purchase_orders
for each row
execute function public.set_updated_at();

create table if not exists public.vendor_invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  invoice_number text not null unique,
  amount numeric(12, 2) not null default 0,
  currency text not null default 'USD',
  issue_date date not null,
  due_date date not null,
  pdf_url text,
  description text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'overdue', 'cancelled')),
  paid_amount numeric(12, 2) not null default 0,
  notes text,
  uploaded_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists vendor_invoices_set_updated_at on public.vendor_invoices;
create trigger vendor_invoices_set_updated_at
before update on public.vendor_invoices
for each row
execute function public.set_updated_at();

create table if not exists public.vendor_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  vendor_invoice_id uuid references public.vendor_invoices (id) on delete set null,
  amount_paid numeric(12, 2) not null default 0,
  payment_date date not null,
  payment_method text not null check (payment_method in ('check', 'bank_transfer', 'credit_card', 'cash', 'other')),
  reference_number text not null unique,
  notes text,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists vendor_payments_set_updated_at on public.vendor_payments;
create trigger vendor_payments_set_updated_at
before update on public.vendor_payments
for each row
execute function public.set_updated_at();

create table if not exists public.expense_records (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  amount numeric(12, 2) not null default 0,
  description text not null,
  expense_date date not null,
  approved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists expense_records_set_updated_at on public.expense_records;
create trigger expense_records_set_updated_at
before update on public.expense_records
for each row
execute function public.set_updated_at();

create table if not exists public.daily_sales_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  amount numeric(12, 2) not null default 0,
  payment_method text not null check (payment_method in ('cash', 'card', 'mobile', 'bank_transfer', 'check', 'other')),
  product_type text not null default 'other',
  description text,
  employee_id uuid references public.profiles (id) on delete set null,
  reconciled boolean not null default false,
  reconciled_by uuid references public.profiles (id) on delete set null,
  reconciled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists daily_sales_entries_set_updated_at on public.daily_sales_entries;
create trigger daily_sales_entries_set_updated_at
before update on public.daily_sales_entries
for each row
execute function public.set_updated_at();

create table if not exists public.daily_sales_reconciliations (
  id uuid primary key default gen_random_uuid(),
  reconciliation_date date not null unique,
  opening_float numeric(12, 2) not null default 0,
  closing_float numeric(12, 2) not null default 0,
  cash_counted numeric(12, 2) not null default 0,
  total_payouts numeric(12, 2) not null default 0,
  total_cash_sales numeric(12, 2) not null default 0,
  total_card_sales numeric(12, 2) not null default 0,
  total_expected numeric(12, 2) not null default 0,
  total_actual numeric(12, 2) not null default 0,
  variance numeric(12, 2) not null default 0,
  variance_percent numeric(8, 2) not null default 0,
  product_breakdown jsonb not null default '{}'::jsonb,
  reconciled_by uuid references public.profiles (id) on delete set null,
  reconciled_at timestamptz not null default timezone('utc', now()),
  notes text,
  status text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists daily_sales_reconciliations_set_updated_at on public.daily_sales_reconciliations;
create trigger daily_sales_reconciliations_set_updated_at
before update on public.daily_sales_reconciliations
for each row
execute function public.set_updated_at();

create index if not exists customers_segment_idx
  on public.customers (segment);

create index if not exists suppliers_status_idx
  on public.suppliers (status);

create index if not exists products_supplier_id_idx
  on public.products (supplier_id);

create index if not exists products_category_idx
  on public.products (category);

create index if not exists sales_orders_customer_id_created_at_idx
  on public.sales_orders (customer_id, created_at desc);

create index if not exists sales_orders_payment_status_idx
  on public.sales_orders (payment_status, created_at desc);

create index if not exists sales_orders_fulfillment_status_idx
  on public.sales_orders (fulfillment_status, promised_date);

create index if not exists sales_order_items_order_id_idx
  on public.sales_order_items (order_id);

create index if not exists sales_order_items_product_id_idx
  on public.sales_order_items (product_id);

create index if not exists purchase_orders_supplier_id_eta_idx
  on public.purchase_orders (supplier_id, eta);

create index if not exists purchase_orders_status_idx
  on public.purchase_orders (status, eta);

create index if not exists vendor_invoices_supplier_id_due_date_idx
  on public.vendor_invoices (supplier_id, due_date);

create index if not exists vendor_invoices_status_idx
  on public.vendor_invoices (status, due_date);

create index if not exists vendor_payments_supplier_id_payment_date_idx
  on public.vendor_payments (supplier_id, payment_date desc);

create index if not exists vendor_payments_invoice_id_idx
  on public.vendor_payments (vendor_invoice_id);

create index if not exists expense_records_expense_date_idx
  on public.expense_records (expense_date desc);

create index if not exists daily_sales_entries_entry_date_idx
  on public.daily_sales_entries (entry_date desc);

create index if not exists daily_sales_entries_employee_id_idx
  on public.daily_sales_entries (employee_id, entry_date desc);

create index if not exists daily_sales_entries_payment_method_idx
  on public.daily_sales_entries (payment_method, entry_date desc);

alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.sales_orders enable row level security;
alter table public.sales_order_items enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.vendor_invoices enable row level security;
alter table public.vendor_payments enable row level security;
alter table public.expense_records enable row level security;
alter table public.daily_sales_entries enable row level security;
alter table public.daily_sales_reconciliations enable row level security;

create policy "customers_select_operations"
on public.customers
for select
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier'])));

create policy "customers_manage_operations"
on public.customers
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier'])))
with check ((select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier'])));

create policy "suppliers_select_management"
on public.suppliers
for select
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])));

create policy "suppliers_manage_management"
on public.suppliers
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])))
with check ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])));

create policy "products_select_staff"
on public.products
for select
to authenticated
using (true);

create policy "products_manage_management"
on public.products
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])))
with check ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])));

create policy "sales_orders_select_operations"
on public.sales_orders
for select
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier'])));

create policy "sales_orders_manage_operations"
on public.sales_orders
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier'])))
with check ((select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier'])));

create policy "sales_order_items_select_operations"
on public.sales_order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.sales_orders
    where public.sales_orders.id = sales_order_items.order_id
      and (select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier']))
  )
);

create policy "sales_order_items_manage_operations"
on public.sales_order_items
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier'])))
with check ((select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier'])));

create policy "purchase_orders_select_management"
on public.purchase_orders
for select
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])));

create policy "purchase_orders_manage_management"
on public.purchase_orders
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])))
with check ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])));

create policy "vendor_invoices_select_management"
on public.vendor_invoices
for select
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])));

create policy "vendor_invoices_manage_management"
on public.vendor_invoices
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])))
with check ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])));

create policy "vendor_payments_select_management"
on public.vendor_payments
for select
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])));

create policy "vendor_payments_manage_management"
on public.vendor_payments
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])))
with check ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])));

create policy "expense_records_select_management"
on public.expense_records
for select
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])));

create policy "expense_records_manage_management"
on public.expense_records
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])))
with check ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])));

create policy "daily_sales_entries_select_staff"
on public.daily_sales_entries
for select
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

create policy "daily_sales_entries_manage_staff"
on public.daily_sales_entries
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier', 'employee'])))
with check ((select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

create policy "daily_sales_reconciliations_select_staff"
on public.daily_sales_reconciliations
for select
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

create policy "daily_sales_reconciliations_manage_staff"
on public.daily_sales_reconciliations
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier', 'employee'])))
with check ((select public.is_current_user_role(array['admin', 'manager', 'accountant', 'cashier', 'employee'])));
