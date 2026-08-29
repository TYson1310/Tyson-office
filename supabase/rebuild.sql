-- Combined rebuild script generated from supabase/migrations in lexical order.
-- Run this in the Supabase SQL editor for a clean schema rebuild without demo seed data.

-- ================================================
-- 202604180001_auth_payroll_foundation.sql
-- ================================================
create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique,
  full_name text,
  role text not null default 'employee' check (role in ('admin', 'manager', 'employee', 'cashier', 'warehouse', 'accountant')),
  status text not null default 'active' check (status in ('active', 'inactive', 'on-leave')),
  permissions text[] not null default '{}'::text[],
  avatar_url text,
  department text,
  position_title text,
  manager_name text,
  employee_number text,
  pay_frequency text default 'Bi-weekly',
  bank_name text,
  bank_account_last4 text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text;
begin
  requested_role := coalesce(new.raw_user_meta_data ->> 'role', 'employee');

  insert into public.profiles (
    id,
    email,
    full_name,
    role,
    status,
    permissions,
    department,
    position_title
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    case
      when requested_role in ('admin', 'manager', 'employee', 'cashier', 'warehouse', 'accountant') then requested_role
      else 'employee'
    end,
    'active',
    case
      when requested_role = 'admin' then array['*']::text[]
      when requested_role = 'manager' then array['view:dashboard', 'view:inventory', 'view:orders', 'view:suppliers', 'view:payroll', 'view:reports']::text[]
      when requested_role = 'accountant' then array['view:financials', 'view:payroll', 'view:vendors', 'view:reports']::text[]
      when requested_role = 'cashier' then array['view:profile', 'view:sales', 'create:sales']::text[]
      when requested_role = 'warehouse' then array['view:inventory', 'update:inventory', 'view:profile']::text[]
      else array['view:profile', 'view:schedule', 'view:payroll', 'view:performance']::text[]
    end,
    new.raw_user_meta_data ->> 'department',
    new.raw_user_meta_data ->> 'position_title'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    role = excluded.role,
    permissions = excluded.permissions,
    department = coalesce(excluded.department, public.profiles.department),
    position_title = coalesce(excluded.position_title, public.profiles.position_title),
    updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

create or replace function public.is_current_user_role(check_roles text[])
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = any (check_roles)
  );
$$;

create table if not exists public.pay_statements (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  period_label text not null,
  period_start date not null,
  period_end date not null,
  pay_date date not null,
  gross_pay numeric(12, 2) not null default 0,
  deductions_total numeric(12, 2) not null default 0,
  net_pay numeric(12, 2) not null default 0,
  overtime_hours numeric(8, 2) not null default 0,
  bonus_amount numeric(12, 2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'paid')),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists pay_statements_set_updated_at on public.pay_statements;
create trigger pay_statements_set_updated_at
before update on public.pay_statements
for each row
execute function public.set_updated_at();

create table if not exists public.pay_statement_deductions (
  id uuid primary key default gen_random_uuid(),
  pay_statement_id uuid not null references public.pay_statements (id) on delete cascade,
  label text not null,
  amount numeric(12, 2) not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.payroll_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  pay_statement_id uuid references public.pay_statements (id) on delete set null,
  name text not null,
  category text not null check (category in ('pay_statement', 'tax_summary', 'deposit_advice')),
  period_label text not null,
  issued_on date not null,
  status text not null default 'ready' check (status in ('ready', 'paid', 'filed')),
  storage_bucket text not null default 'payroll-documents',
  storage_path text,
  external_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists payroll_documents_set_updated_at on public.payroll_documents;
create trigger payroll_documents_set_updated_at
before update on public.payroll_documents
for each row
execute function public.set_updated_at();

create index if not exists pay_statements_employee_id_pay_date_idx
  on public.pay_statements (employee_id, pay_date desc);

create index if not exists pay_statement_deductions_statement_id_idx
  on public.pay_statement_deductions (pay_statement_id, sort_order);

create index if not exists payroll_documents_employee_id_issued_on_idx
  on public.payroll_documents (employee_id, issued_on desc);

alter table public.profiles enable row level security;
alter table public.pay_statements enable row level security;
alter table public.pay_statement_deductions enable row level security;
alter table public.payroll_documents enable row level security;

create policy "profiles_select_own_or_admin"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "pay_statements_select_own_or_admin"
on public.pay_statements
for select
to authenticated
using (
  employee_id = (select auth.uid())
  or (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);

create policy "pay_statements_manage_admin"
on public.pay_statements
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])))
with check ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])));

create policy "pay_statement_deductions_select_own_or_admin"
on public.pay_statement_deductions
for select
to authenticated
using (
  exists (
    select 1
    from public.pay_statements
    where public.pay_statements.id = pay_statement_deductions.pay_statement_id
      and (
        public.pay_statements.employee_id = (select auth.uid())
        or (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
      )
  )
);

create policy "pay_statement_deductions_manage_admin"
on public.pay_statement_deductions
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])))
with check ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])));

create policy "payroll_documents_select_own_or_admin"
on public.payroll_documents
for select
to authenticated
using (
  employee_id = (select auth.uid())
  or (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);

create policy "payroll_documents_manage_admin"
on public.payroll_documents
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])))
with check ((select public.is_current_user_role(array['admin', 'manager', 'accountant'])));

insert into storage.buckets (id, name, public)
values ('payroll-documents', 'payroll-documents', false)
on conflict (id) do nothing;

create policy "payroll_storage_read_own_or_admin"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'payroll-documents'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
  )
);

create policy "payroll_storage_write_admin"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payroll-documents'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);

create policy "payroll_storage_update_admin"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'payroll-documents'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
)
with check (
  bucket_id = 'payroll-documents'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);
-- END 202604180001_auth_payroll_foundation.sql

-- ================================================
-- 202604180002_backfill_profiles.sql
-- ================================================
insert into public.profiles (
  id,
  email,
  full_name,
  role,
  status,
  permissions,
  department,
  position_title
)
select
  users.id,
  users.email,
  coalesce(
    users.raw_user_meta_data ->> 'full_name',
    split_part(coalesce(users.email, ''), '@', 1)
  ) as full_name,
  case
    when coalesce(users.raw_user_meta_data ->> 'role', 'employee') in (
      'admin',
      'manager',
      'employee',
      'cashier',
      'warehouse',
      'accountant'
    ) then coalesce(users.raw_user_meta_data ->> 'role', 'employee')
    else 'employee'
  end as role,
  'active' as status,
  case
    when coalesce(users.raw_user_meta_data ->> 'role', 'employee') = 'admin' then array['*']::text[]
    when coalesce(users.raw_user_meta_data ->> 'role', 'employee') = 'manager' then array[
      'view:dashboard',
      'view:inventory',
      'view:orders',
      'view:suppliers',
      'view:payroll',
      'view:reports'
    ]::text[]
    when coalesce(users.raw_user_meta_data ->> 'role', 'employee') = 'accountant' then array[
      'view:financials',
      'view:payroll',
      'view:vendors',
      'view:reports'
    ]::text[]
    when coalesce(users.raw_user_meta_data ->> 'role', 'employee') = 'cashier' then array[
      'view:profile',
      'view:sales',
      'create:sales'
    ]::text[]
    when coalesce(users.raw_user_meta_data ->> 'role', 'employee') = 'warehouse' then array[
      'view:inventory',
      'update:inventory',
      'view:profile'
    ]::text[]
    else array[
      'view:profile',
      'view:schedule',
      'view:payroll',
      'view:performance'
    ]::text[]
  end as permissions,
  users.raw_user_meta_data ->> 'department' as department,
  users.raw_user_meta_data ->> 'position_title' as position_title
from auth.users as users
left join public.profiles as profiles on profiles.id = users.id
where profiles.id is null;
-- END 202604180002_backfill_profiles.sql

-- ================================================
-- 202604180003_commerce_operations_foundation.sql
-- ================================================
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
  barcode text,
  category text not null,
  price numeric(12, 2) not null default 0,
  cost numeric(12, 2) not null default 0,
  quantity integer not null default 0,
  reorder_level integer not null default 0,
  location text,
  daily_velocity numeric(8, 2) not null default 0,
  target_margin_percent numeric(5, 2) not null default 40,
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
-- END 202604180003_commerce_operations_foundation.sql

-- ================================================
-- 202604180004_profiles_admin_management.sql
-- ================================================
create policy "profiles_update_admin_or_manager"
on public.profiles
for update
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager'])))
with check ((select public.is_current_user_role(array['admin', 'manager'])));
-- END 202604180004_profiles_admin_management.sql

-- ================================================
-- 202604180005_profiles_staff_fields.sql
-- ================================================
alter table public.profiles
  add column if not exists phone text,
  add column if not exists monthly_salary numeric(12, 2) not null default 0;
-- END 202604180005_profiles_staff_fields.sql

-- ================================================
-- 202604190001_hourly_payroll_fields.sql
-- ================================================
alter table public.profiles
  add column if not exists hourly_rate numeric(12, 2) not null default 0;

alter table public.pay_statements
  add column if not exists regular_hours numeric(8, 2) not null default 0,
  add column if not exists hourly_rate numeric(12, 2) not null default 0,
  add column if not exists overtime_multiplier numeric(4, 2) not null default 1.5;
-- END 202604190001_hourly_payroll_fields.sql

-- ================================================
-- 202604190002_shift_time_entries.sql
-- ================================================
create table if not exists public.shift_time_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  entry_date date not null,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  hours_worked numeric(8, 2) not null default 0,
  entry_type text not null check (entry_type in ('automatic', 'manual')),
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint shift_time_entries_clock_sequence
    check (clock_out_at is null or clock_out_at >= clock_in_at),
  constraint shift_time_entries_non_negative_hours
    check (hours_worked >= 0)
);

drop trigger if exists shift_time_entries_set_updated_at on public.shift_time_entries;
create trigger shift_time_entries_set_updated_at
before update on public.shift_time_entries
for each row
execute function public.set_updated_at();

create index if not exists shift_time_entries_employee_id_entry_date_idx
  on public.shift_time_entries (employee_id, entry_date desc, clock_in_at desc);

create index if not exists shift_time_entries_entry_date_clock_in_at_idx
  on public.shift_time_entries (entry_date desc, clock_in_at desc);

create unique index if not exists shift_time_entries_open_shift_unique_idx
  on public.shift_time_entries (employee_id)
  where clock_out_at is null;

alter table public.shift_time_entries enable row level security;

create policy "shift_time_entries_select_own_or_admin"
on public.shift_time_entries
for select
to authenticated
using (
  employee_id = (select auth.uid())
  or (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);

create policy "shift_time_entries_manage_admin"
on public.shift_time_entries
for all
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager'])))
with check ((select public.is_current_user_role(array['admin', 'manager'])));
-- END 202604190002_shift_time_entries.sql

-- ================================================
-- 202604190003_shift_overlap_constraint.sql
-- ================================================
create extension if not exists btree_gist;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'shift_time_entries_employee_time_no_overlap'
  ) then
    alter table public.shift_time_entries
      drop constraint shift_time_entries_employee_time_no_overlap;
  end if;

  begin
    alter table public.shift_time_entries
      add constraint shift_time_entries_employee_time_no_overlap
      exclude using gist (
        employee_id with =,
        tstzrange(
          clock_in_at,
          coalesce(clock_out_at, 'infinity'::timestamptz),
          '[)'
        ) with &&
      )
      where (entry_type = 'manual');
  exception
    when duplicate_object then null;
  end;
end
$$;
-- END 202604190003_shift_overlap_constraint.sql

-- ================================================
-- 202604190004_payroll_run_frequency_lock.sql
-- ================================================
alter table public.pay_statements
  add column if not exists pay_frequency text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pay_statements_pay_frequency_check'
  ) then
    alter table public.pay_statements
      add constraint pay_statements_pay_frequency_check
      check (pay_frequency is null or pay_frequency in ('weekly', 'monthly'));
  end if;
end
$$;

create index if not exists pay_statements_frequency_period_idx
  on public.pay_statements (pay_frequency, period_start, period_end);

create unique index if not exists pay_statements_employee_term_frequency_unique_idx
  on public.pay_statements (employee_id, pay_frequency, period_start, period_end)
  where pay_frequency is not null;
-- END 202604190004_payroll_run_frequency_lock.sql

-- ================================================
-- 202604190005_store_settings_configuration.sql
-- ================================================
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
    {"id":"net_sale","label":"Net Sale","description":"Sales before tax and fees","color":"#16a34a","enabled":true},
    {"id":"tax","label":"Tax","description":"Sales tax collected","color":"#f59e0b","enabled":true},
    {"id":"card_charge","label":"Card Charge","description":"Card processor or terminal charges","color":"#2563eb","enabled":true},
    {"id":"other_fees","label":"Other Fees","description":"Other daily charges and fees","color":"#9333ea","enabled":true}
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
-- END 202604190005_store_settings_configuration.sql

-- ================================================
-- 202604200001_vendor_invoice_storage.sql
-- ================================================
insert into storage.buckets (id, name, public)
values ('vendor-invoices', 'vendor-invoices', true)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "vendor_invoice_storage_select_management" on storage.objects;
create policy "vendor_invoice_storage_select_management"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'vendor-invoices'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);

drop policy if exists "vendor_invoice_storage_insert_management" on storage.objects;
create policy "vendor_invoice_storage_insert_management"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'vendor-invoices'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);

drop policy if exists "vendor_invoice_storage_update_management" on storage.objects;
create policy "vendor_invoice_storage_update_management"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'vendor-invoices'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
)
with check (
  bucket_id = 'vendor-invoices'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);

drop policy if exists "vendor_invoice_storage_delete_management" on storage.objects;
create policy "vendor_invoice_storage_delete_management"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'vendor-invoices'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);
-- END 202604200001_vendor_invoice_storage.sql

-- ================================================
-- 202604200002_multi_store_foundation.sql
-- ================================================
create table if not exists public.stores (
  store_key text primary key,
  name text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists stores_set_updated_at on public.stores;
create trigger stores_set_updated_at
before update on public.stores
for each row
execute function public.set_updated_at();

insert into public.stores (store_key, name, status)
values ('default', 'Default Store', 'active')
on conflict (store_key) do update
set
  name = excluded.name,
  status = excluded.status;

alter table public.profiles
  add column if not exists store_key text references public.stores (store_key) on delete restrict;

update public.profiles
set store_key = 'default'
where store_key is null;

alter table public.profiles
  alter column store_key set default 'default',
  alter column store_key set not null;

create index if not exists profiles_store_key_idx
  on public.profiles (store_key, role);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text;
  requested_store_key text;
begin
  requested_role := coalesce(new.raw_user_meta_data ->> 'role', 'employee');
  requested_store_key := coalesce(new.raw_user_meta_data ->> 'store_key', 'default');

  if not exists (
    select 1
    from public.stores
    where store_key = requested_store_key
  ) then
    requested_store_key := 'default';
  end if;

  insert into public.profiles (
    id,
    email,
    full_name,
    role,
    store_key,
    status,
    permissions,
    department,
    position_title
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    case
      when requested_role in ('admin', 'manager', 'employee', 'cashier', 'warehouse', 'accountant') then requested_role
      else 'employee'
    end,
    requested_store_key,
    'active',
    case
      when requested_role = 'admin' then array['*']::text[]
      when requested_role = 'manager' then array['view:dashboard', 'view:inventory', 'view:orders', 'view:suppliers', 'view:payroll', 'view:reports']::text[]
      when requested_role = 'accountant' then array['view:financials', 'view:payroll', 'view:vendors', 'view:reports']::text[]
      when requested_role = 'cashier' then array['view:profile', 'view:sales', 'create:sales']::text[]
      when requested_role = 'warehouse' then array['view:inventory', 'update:inventory', 'view:profile']::text[]
      else array['view:profile', 'view:schedule', 'view:payroll', 'view:performance']::text[]
    end,
    new.raw_user_meta_data ->> 'department',
    new.raw_user_meta_data ->> 'position_title'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    role = excluded.role,
    store_key = excluded.store_key,
    permissions = excluded.permissions,
    department = coalesce(excluded.department, public.profiles.department),
    position_title = coalesce(excluded.position_title, public.profiles.position_title),
    updated_at = timezone('utc', now());

  return new;
end;
$$;

create or replace function public.current_user_store_key()
returns text
language sql
security definer
set search_path = public
as $$
  select store_key
  from public.profiles
  where id = (select auth.uid());
$$;

create or replace function public.can_access_store(
  target_store_key text,
  allowed_roles text[]
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = any (allowed_roles)
      and (
        role = 'admin'
        or store_key = target_store_key
      )
  );
$$;

alter table public.pay_statements
  add column if not exists store_key text references public.stores (store_key) on delete restrict;
update public.pay_statements set store_key = 'default' where store_key is null;
alter table public.pay_statements
  alter column store_key set default 'default',
  alter column store_key set not null;
create index if not exists pay_statements_store_key_idx
  on public.pay_statements (store_key, pay_date desc);

alter table public.payroll_documents
  add column if not exists store_key text references public.stores (store_key) on delete restrict;
update public.payroll_documents set store_key = 'default' where store_key is null;
alter table public.payroll_documents
  alter column store_key set default 'default',
  alter column store_key set not null;
create index if not exists payroll_documents_store_key_idx
  on public.payroll_documents (store_key, issued_on desc);

alter table public.shift_time_entries
  add column if not exists store_key text references public.stores (store_key) on delete restrict;
update public.shift_time_entries set store_key = 'default' where store_key is null;
alter table public.shift_time_entries
  alter column store_key set default 'default',
  alter column store_key set not null;
create index if not exists shift_time_entries_store_key_idx
  on public.shift_time_entries (store_key, entry_date desc);

alter table public.customers
  add column if not exists store_key text references public.stores (store_key) on delete restrict;
update public.customers set store_key = 'default' where store_key is null;
alter table public.customers
  alter column store_key set default 'default',
  alter column store_key set not null;
create index if not exists customers_store_key_idx
  on public.customers (store_key, name);

alter table public.suppliers
  add column if not exists store_key text references public.stores (store_key) on delete restrict;
update public.suppliers set store_key = 'default' where store_key is null;
alter table public.suppliers
  alter column store_key set default 'default',
  alter column store_key set not null;
create index if not exists suppliers_store_key_idx
  on public.suppliers (store_key, name);

alter table public.products
  add column if not exists store_key text references public.stores (store_key) on delete restrict;
update public.products set store_key = 'default' where store_key is null;
alter table public.products
  alter column store_key set default 'default',
  alter column store_key set not null;
create index if not exists products_store_key_idx
  on public.products (store_key, name);

alter table public.sales_orders
  add column if not exists store_key text references public.stores (store_key) on delete restrict;
update public.sales_orders set store_key = 'default' where store_key is null;
alter table public.sales_orders
  alter column store_key set default 'default',
  alter column store_key set not null;
create index if not exists sales_orders_store_key_idx
  on public.sales_orders (store_key, created_at desc);

alter table public.purchase_orders
  add column if not exists store_key text references public.stores (store_key) on delete restrict;
update public.purchase_orders set store_key = 'default' where store_key is null;
alter table public.purchase_orders
  alter column store_key set default 'default',
  alter column store_key set not null;
create index if not exists purchase_orders_store_key_idx
  on public.purchase_orders (store_key, created_at desc);

alter table public.vendor_invoices
  add column if not exists store_key text references public.stores (store_key) on delete restrict;
update public.vendor_invoices set store_key = 'default' where store_key is null;
alter table public.vendor_invoices
  alter column store_key set default 'default',
  alter column store_key set not null;
create index if not exists vendor_invoices_store_key_idx
  on public.vendor_invoices (store_key, due_date desc);

alter table public.vendor_payments
  add column if not exists store_key text references public.stores (store_key) on delete restrict;
update public.vendor_payments set store_key = 'default' where store_key is null;
alter table public.vendor_payments
  alter column store_key set default 'default',
  alter column store_key set not null;
create index if not exists vendor_payments_store_key_idx
  on public.vendor_payments (store_key, payment_date desc);

alter table public.expense_records
  add column if not exists store_key text references public.stores (store_key) on delete restrict;
update public.expense_records set store_key = 'default' where store_key is null;
alter table public.expense_records
  alter column store_key set default 'default',
  alter column store_key set not null;
create index if not exists expense_records_store_key_idx
  on public.expense_records (store_key, expense_date desc);

alter table public.daily_sales_entries
  add column if not exists store_key text references public.stores (store_key) on delete restrict;
update public.daily_sales_entries set store_key = 'default' where store_key is null;
alter table public.daily_sales_entries
  alter column store_key set default 'default',
  alter column store_key set not null;
create index if not exists daily_sales_entries_store_key_idx
  on public.daily_sales_entries (store_key, entry_date desc);

alter table public.daily_sales_reconciliations
  add column if not exists store_key text references public.stores (store_key) on delete restrict;
update public.daily_sales_reconciliations set store_key = 'default' where store_key is null;
alter table public.daily_sales_reconciliations
  alter column store_key set default 'default',
  alter column store_key set not null;
create index if not exists daily_sales_reconciliations_store_key_idx
  on public.daily_sales_reconciliations (store_key, reconciliation_date desc);

alter table public.store_settings
  drop constraint if exists store_settings_store_key_check;

alter table public.store_settings
  drop constraint if exists store_settings_store_key_fkey;

alter table public.store_settings
  add constraint store_settings_store_key_fkey
  foreign key (store_key)
  references public.stores (store_key)
  on delete cascade;

alter table public.customers drop constraint if exists customers_email_key;
create unique index if not exists customers_store_email_unique_idx
  on public.customers (store_key, lower(email))
  where email is not null;

alter table public.suppliers drop constraint if exists suppliers_email_key;
create unique index if not exists suppliers_store_email_unique_idx
  on public.suppliers (store_key, lower(email))
  where email is not null;

alter table public.products drop constraint if exists products_sku_key;
create unique index if not exists products_store_sku_unique_idx
  on public.products (store_key, sku);

create index if not exists products_store_barcode_idx
  on public.products (store_key, barcode)
  where barcode is not null;

alter table public.sales_orders drop constraint if exists sales_orders_order_number_key;
create unique index if not exists sales_orders_store_order_number_unique_idx
  on public.sales_orders (store_key, order_number);

alter table public.purchase_orders drop constraint if exists purchase_orders_po_number_key;
create unique index if not exists purchase_orders_store_po_number_unique_idx
  on public.purchase_orders (store_key, po_number);

alter table public.vendor_invoices drop constraint if exists vendor_invoices_invoice_number_key;
create unique index if not exists vendor_invoices_store_invoice_number_unique_idx
  on public.vendor_invoices (store_key, invoice_number);

alter table public.vendor_payments drop constraint if exists vendor_payments_reference_number_key;
create unique index if not exists vendor_payments_store_reference_number_unique_idx
  on public.vendor_payments (store_key, reference_number);

alter table public.daily_sales_reconciliations
  drop constraint if exists daily_sales_reconciliations_reconciliation_date_key;
create unique index if not exists daily_sales_reconciliations_store_date_unique_idx
  on public.daily_sales_reconciliations (store_key, reconciliation_date);

alter table public.stores enable row level security;

drop policy if exists "stores_select_authenticated" on public.stores;
create policy "stores_select_authenticated"
on public.stores
for select
to authenticated
using (true);

drop policy if exists "stores_manage_admin" on public.stores;
create policy "stores_manage_admin"
on public.stores
for all
to authenticated
using ((select public.is_current_user_role(array['admin'])))
with check ((select public.is_current_user_role(array['admin'])));

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (select public.can_access_store(store_key, array['admin', 'manager', 'accountant']))
);

drop policy if exists "profiles_update_admin_or_manager" on public.profiles;
create policy "profiles_update_admin_or_manager"
on public.profiles
for update
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager'])));

drop policy if exists "pay_statements_select_own_or_admin" on public.pay_statements;
create policy "pay_statements_select_own_or_admin"
on public.pay_statements
for select
to authenticated
using (
  employee_id = (select auth.uid())
  or (select public.can_access_store(store_key, array['admin', 'manager', 'accountant']))
);

drop policy if exists "pay_statements_manage_admin" on public.pay_statements;
create policy "pay_statements_manage_admin"
on public.pay_statements
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "pay_statement_deductions_select_own_or_admin" on public.pay_statement_deductions;
create policy "pay_statement_deductions_select_own_or_admin"
on public.pay_statement_deductions
for select
to authenticated
using (
  exists (
    select 1
    from public.pay_statements
    where public.pay_statements.id = pay_statement_deductions.pay_statement_id
      and (
        public.pay_statements.employee_id = (select auth.uid())
        or (select public.can_access_store(public.pay_statements.store_key, array['admin', 'manager', 'accountant']))
      )
  )
);

drop policy if exists "pay_statement_deductions_manage_admin" on public.pay_statement_deductions;
create policy "pay_statement_deductions_manage_admin"
on public.pay_statement_deductions
for all
to authenticated
using (
  exists (
    select 1
    from public.pay_statements
    where public.pay_statements.id = pay_statement_deductions.pay_statement_id
      and (select public.can_access_store(public.pay_statements.store_key, array['admin', 'manager', 'accountant']))
  )
)
with check (
  exists (
    select 1
    from public.pay_statements
    where public.pay_statements.id = pay_statement_deductions.pay_statement_id
      and (select public.can_access_store(public.pay_statements.store_key, array['admin', 'manager', 'accountant']))
  )
);

drop policy if exists "payroll_documents_select_own_or_admin" on public.payroll_documents;
create policy "payroll_documents_select_own_or_admin"
on public.payroll_documents
for select
to authenticated
using (
  employee_id = (select auth.uid())
  or (select public.can_access_store(store_key, array['admin', 'manager', 'accountant']))
);

drop policy if exists "payroll_documents_manage_admin" on public.payroll_documents;
create policy "payroll_documents_manage_admin"
on public.payroll_documents
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "shift_time_entries_select_own_or_admin" on public.shift_time_entries;
create policy "shift_time_entries_select_own_or_admin"
on public.shift_time_entries
for select
to authenticated
using (
  employee_id = (select auth.uid())
  or (select public.can_access_store(store_key, array['admin', 'manager', 'accountant']))
);

drop policy if exists "shift_time_entries_manage_admin" on public.shift_time_entries;
create policy "shift_time_entries_manage_admin"
on public.shift_time_entries
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager'])));

drop policy if exists "customers_select_operations" on public.customers;
create policy "customers_select_operations"
on public.customers
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier'])));

drop policy if exists "customers_manage_operations" on public.customers;
create policy "customers_manage_operations"
on public.customers
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier'])));

drop policy if exists "suppliers_select_management" on public.suppliers;
create policy "suppliers_select_management"
on public.suppliers
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "suppliers_manage_management" on public.suppliers;
create policy "suppliers_manage_management"
on public.suppliers
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "products_select_staff" on public.products;
create policy "products_select_staff"
on public.products
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee', 'warehouse'])));

drop policy if exists "products_manage_management" on public.products;
create policy "products_manage_management"
on public.products
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "sales_orders_select_operations" on public.sales_orders;
create policy "sales_orders_select_operations"
on public.sales_orders
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier'])));

drop policy if exists "sales_orders_manage_operations" on public.sales_orders;
create policy "sales_orders_manage_operations"
on public.sales_orders
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier'])));

drop policy if exists "sales_order_items_select_operations" on public.sales_order_items;
create policy "sales_order_items_select_operations"
on public.sales_order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.sales_orders
    where public.sales_orders.id = sales_order_items.order_id
      and (select public.can_access_store(public.sales_orders.store_key, array['admin', 'manager', 'accountant', 'cashier']))
  )
);

drop policy if exists "sales_order_items_manage_operations" on public.sales_order_items;
create policy "sales_order_items_manage_operations"
on public.sales_order_items
for all
to authenticated
using (
  exists (
    select 1
    from public.sales_orders
    where public.sales_orders.id = sales_order_items.order_id
      and (select public.can_access_store(public.sales_orders.store_key, array['admin', 'manager', 'accountant', 'cashier']))
  )
)
with check (
  exists (
    select 1
    from public.sales_orders
    where public.sales_orders.id = sales_order_items.order_id
      and (select public.can_access_store(public.sales_orders.store_key, array['admin', 'manager', 'accountant', 'cashier']))
  )
);

drop policy if exists "purchase_orders_select_management" on public.purchase_orders;
create policy "purchase_orders_select_management"
on public.purchase_orders
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "purchase_orders_manage_management" on public.purchase_orders;
create policy "purchase_orders_manage_management"
on public.purchase_orders
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "vendor_invoices_select_management" on public.vendor_invoices;
create policy "vendor_invoices_select_management"
on public.vendor_invoices
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "vendor_invoices_manage_management" on public.vendor_invoices;
create policy "vendor_invoices_manage_management"
on public.vendor_invoices
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "vendor_payments_select_management" on public.vendor_payments;
create policy "vendor_payments_select_management"
on public.vendor_payments
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "vendor_payments_manage_management" on public.vendor_payments;
create policy "vendor_payments_manage_management"
on public.vendor_payments
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "expense_records_select_management" on public.expense_records;
create policy "expense_records_select_management"
on public.expense_records
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "expense_records_manage_management" on public.expense_records;
create policy "expense_records_manage_management"
on public.expense_records
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "daily_sales_entries_select_staff" on public.daily_sales_entries;
create policy "daily_sales_entries_select_staff"
on public.daily_sales_entries
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

drop policy if exists "daily_sales_entries_manage_staff" on public.daily_sales_entries;
create policy "daily_sales_entries_manage_staff"
on public.daily_sales_entries
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

drop policy if exists "daily_sales_reconciliations_select_staff" on public.daily_sales_reconciliations;
create policy "daily_sales_reconciliations_select_staff"
on public.daily_sales_reconciliations
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

drop policy if exists "daily_sales_reconciliations_manage_staff" on public.daily_sales_reconciliations;
create policy "daily_sales_reconciliations_manage_staff"
on public.daily_sales_reconciliations
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])));
-- END 202604200002_multi_store_foundation.sql

-- ================================================
-- 202604210001_store_settings_store_backfill.sql
-- ================================================
create or replace function public.handle_new_store_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.store_settings (store_key)
  values (new.store_key)
  on conflict (store_key) do nothing;

  return new;
end;
$$;

drop trigger if exists stores_create_default_settings on public.stores;
create trigger stores_create_default_settings
after insert on public.stores
for each row
execute function public.handle_new_store_settings();

insert into public.store_settings (store_key)
select s.store_key
from public.stores as s
left join public.store_settings as ss
  on ss.store_key = s.store_key
where ss.store_key is null
on conflict (store_key) do nothing;
-- END 202604210001_store_settings_store_backfill.sql

-- ================================================
-- 202604210002_shift_verification_self_service.sql
-- ================================================
alter table public.shift_time_entries
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.profiles (id) on delete set null;

update public.shift_time_entries
set verified_at = coalesce(verified_at, updated_at, created_at),
    verified_by = coalesce(verified_by, updated_by, created_by)
where entry_type = 'manual'
  and verified_at is null;

create index if not exists shift_time_entries_verification_idx
  on public.shift_time_entries (store_key, entry_type, verified_at, entry_date desc);

drop policy if exists "shift_time_entries_insert_own_automatic" on public.shift_time_entries;
create policy "shift_time_entries_insert_own_automatic"
on public.shift_time_entries
for insert
to authenticated
with check (
  employee_id = (select auth.uid())
  and entry_type = 'automatic'
  and clock_out_at is null
  and hours_worked = 0
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and verified_at is null
  and verified_by is null
  and (
    select public.can_access_store(
      store_key,
      array['manager', 'accountant', 'cashier', 'warehouse', 'employee']
    )
  )
);

drop policy if exists "shift_time_entries_update_own_automatic" on public.shift_time_entries;
create policy "shift_time_entries_update_own_automatic"
on public.shift_time_entries
for update
to authenticated
using (
  employee_id = (select auth.uid())
  and entry_type = 'automatic'
  and clock_out_at is null
  and (
    select public.can_access_store(
      store_key,
      array['manager', 'accountant', 'cashier', 'warehouse', 'employee']
    )
  )
)
with check (
  employee_id = (select auth.uid())
  and entry_type = 'automatic'
  and clock_out_at is not null
  and updated_by = (select auth.uid())
  and verified_at is null
  and verified_by is null
  and (
    select public.can_access_store(
      store_key,
      array['manager', 'accountant', 'cashier', 'warehouse', 'employee']
    )
  )
);
-- END 202604210002_shift_verification_self_service.sql

-- ================================================
-- 202604210003_general_expense_tracking.sql
-- ================================================
alter table public.expense_records
  add column if not exists vendor_name text,
  add column if not exists payment_method text
    check (payment_method in ('cash', 'card', 'mobile', 'bank_transfer', 'check', 'other')),
  add column if not exists notes text,
  add column if not exists created_by uuid references public.profiles (id) on delete set null,
  add column if not exists status text not null default 'approved'
    check (status in ('draft', 'approved')),
  add column if not exists approved_at timestamptz;

update public.expense_records
set status = 'approved'
where status is null;

update public.expense_records
set approved_at = coalesce(approved_at, created_at)
where status = 'approved'
  and approved_at is null;

create index if not exists expense_records_store_key_approved_expense_date_idx
  on public.expense_records (store_key, expense_date desc)
  where status = 'approved';

create index if not exists expense_records_store_key_category_approved_expense_date_idx
  on public.expense_records (store_key, category, expense_date desc)
  where status = 'approved';

create index if not exists expense_records_store_key_created_by_created_at_idx
  on public.expense_records (store_key, created_by, created_at desc);
-- END 202604210003_general_expense_tracking.sql

-- ================================================
-- 202604210004_vendor_adjustments.sql
-- ================================================
create table if not exists public.vendor_adjustments (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  vendor_invoice_id uuid references public.vendor_invoices (id) on delete set null,
  adjustment_number text not null,
  adjustment_type text not null
    check (adjustment_type in ('return', 'credit_note', 'shortage', 'damage', 'rebate', 'other')),
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  currency text not null default 'USD',
  adjustment_date date not null,
  reason text,
  notes text,
  inventory_impact boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists vendor_adjustments_set_updated_at on public.vendor_adjustments;
create trigger vendor_adjustments_set_updated_at
before update on public.vendor_adjustments
for each row
execute function public.set_updated_at();

create table if not exists public.vendor_adjustment_items (
  id uuid primary key default gen_random_uuid(),
  vendor_adjustment_id uuid not null references public.vendor_adjustments (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  description text not null,
  quantity integer not null default 0 check (quantity >= 0),
  unit_cost numeric(12, 2) not null default 0 check (unit_cost >= 0),
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists vendor_adjustments_store_number_unique_idx
  on public.vendor_adjustments (store_key, adjustment_number);

create index if not exists vendor_adjustments_store_supplier_date_idx
  on public.vendor_adjustments (store_key, supplier_id, adjustment_date desc);

create index if not exists vendor_adjustments_store_invoice_date_idx
  on public.vendor_adjustments (store_key, vendor_invoice_id, adjustment_date desc);

create index if not exists vendor_adjustment_items_adjustment_id_idx
  on public.vendor_adjustment_items (vendor_adjustment_id);

alter table public.vendor_adjustments enable row level security;
alter table public.vendor_adjustment_items enable row level security;

drop policy if exists "vendor_adjustments_select_management" on public.vendor_adjustments;
create policy "vendor_adjustments_select_management"
on public.vendor_adjustments
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "vendor_adjustments_manage_management" on public.vendor_adjustments;
create policy "vendor_adjustments_manage_management"
on public.vendor_adjustments
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "vendor_adjustment_items_select_management" on public.vendor_adjustment_items;
create policy "vendor_adjustment_items_select_management"
on public.vendor_adjustment_items
for select
to authenticated
using (
  exists (
    select 1
    from public.vendor_adjustments
    where public.vendor_adjustments.id = vendor_adjustment_items.vendor_adjustment_id
      and (select public.can_access_store(public.vendor_adjustments.store_key, array['admin', 'manager', 'accountant']))
  )
);

drop policy if exists "vendor_adjustment_items_manage_management" on public.vendor_adjustment_items;
create policy "vendor_adjustment_items_manage_management"
on public.vendor_adjustment_items
for all
to authenticated
using (
  exists (
    select 1
    from public.vendor_adjustments
    where public.vendor_adjustments.id = vendor_adjustment_items.vendor_adjustment_id
      and (select public.can_access_store(public.vendor_adjustments.store_key, array['admin', 'manager', 'accountant']))
  )
)
with check (
  exists (
    select 1
    from public.vendor_adjustments
    where public.vendor_adjustments.id = vendor_adjustment_items.vendor_adjustment_id
      and (select public.can_access_store(public.vendor_adjustments.store_key, array['admin', 'manager', 'accountant']))
  )
);
-- END 202604210004_vendor_adjustments.sql

-- ================================================
-- 202604210005_vendor_adjustment_controls_inventory_ledger.sql
-- ================================================
alter table public.vendor_adjustments
  add column if not exists status text not null default 'approved'
    check (status in ('draft', 'approved', 'void')),
  add column if not exists approved_by uuid references public.profiles (id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists voided_by uuid references public.profiles (id) on delete set null,
  add column if not exists voided_at timestamptz,
  add column if not exists attachment_name text,
  add column if not exists attachment_path text,
  add column if not exists attachment_url text,
  add column if not exists attachment_mime_type text;

update public.vendor_adjustments
set
  status = coalesce(status, 'approved'),
  approved_by = coalesce(approved_by, created_by),
  approved_at = coalesce(approved_at, created_at)
where status is null
   or (status = 'approved' and approved_at is null);

create index if not exists vendor_adjustments_store_status_date_idx
  on public.vendor_adjustments (store_key, status, adjustment_date desc);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  product_id uuid references public.products (id) on delete set null,
  vendor_adjustment_id uuid references public.vendor_adjustments (id) on delete set null,
  movement_type text not null
    check (movement_type in ('vendor_return', 'vendor_return_reversal')),
  quantity_delta integer not null,
  quantity_before integer not null,
  quantity_after integer not null,
  unit_cost numeric(12, 2) not null default 0,
  total_amount numeric(12, 2) not null default 0,
  product_name text not null,
  product_sku text not null,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists inventory_movements_store_product_created_idx
  on public.inventory_movements (store_key, product_id, created_at desc);

create index if not exists inventory_movements_store_adjustment_created_idx
  on public.inventory_movements (store_key, vendor_adjustment_id, created_at desc);

alter table public.inventory_movements enable row level security;

drop policy if exists "inventory_movements_select_management" on public.inventory_movements;
create policy "inventory_movements_select_management"
on public.inventory_movements
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "inventory_movements_manage_management" on public.inventory_movements;
create policy "inventory_movements_manage_management"
on public.inventory_movements
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));
-- END 202604210005_vendor_adjustment_controls_inventory_ledger.sql

-- ================================================
-- 202604220001_financial_controls_and_vendor_payment_status.sql
-- ================================================
alter table public.vendor_payments
  add column if not exists status text not null default 'posted'
    check (status in ('posted', 'void')),
  add column if not exists voided_by uuid references public.profiles (id) on delete set null,
  add column if not exists voided_at timestamptz;

update public.vendor_payments
set
  status = coalesce(status, 'posted'),
  approved_at = coalesce(approved_at, created_at)
where status is null
   or (status = 'posted' and approved_at is null);

create index if not exists vendor_payments_store_status_payment_date_idx
  on public.vendor_payments (store_key, status, payment_date desc);

create index if not exists vendor_payments_store_invoice_posted_date_idx
  on public.vendor_payments (store_key, vendor_invoice_id, payment_date desc)
  where status = 'posted';

create index if not exists vendor_payments_store_supplier_posted_date_idx
  on public.vendor_payments (store_key, supplier_id, payment_date desc)
  where status = 'posted';

alter table public.store_settings
  add column if not exists accounting_close_through date,
  add column if not exists accounting_close_note text;

create index if not exists expense_records_store_key_draft_expense_date_idx
  on public.expense_records (store_key, expense_date desc)
  where status = 'draft';
-- END 202604220001_financial_controls_and_vendor_payment_status.sql

-- ================================================
-- 202604220002_financial_audit_controls.sql
-- ================================================
alter table public.pay_statements
  add column if not exists archived_by uuid references public.profiles (id) on delete set null,
  add column if not exists archived_at timestamptz;

alter table public.pay_statements
  drop constraint if exists pay_statements_status_check;

alter table public.pay_statements
  add constraint pay_statements_status_check
  check (status in ('draft', 'scheduled', 'paid', 'archived'));

alter table public.expense_records
  add column if not exists voided_by uuid references public.profiles (id) on delete set null,
  add column if not exists voided_at timestamptz;

alter table public.expense_records
  drop constraint if exists expense_records_status_check;

alter table public.expense_records
  add constraint expense_records_status_check
  check (status in ('draft', 'approved', 'void'));

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  summary text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  actor_role text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists audit_events_store_key_created_at_idx
  on public.audit_events (store_key, created_at desc);

create index if not exists audit_events_store_key_entity_idx
  on public.audit_events (store_key, entity_type, entity_id, created_at desc);

create index if not exists audit_events_store_key_actor_idx
  on public.audit_events (store_key, actor_id, created_at desc);

alter table public.audit_events enable row level security;

drop policy if exists "audit_events_select_management" on public.audit_events;
create policy "audit_events_select_management"
on public.audit_events
for select
to authenticated
using (
  (select public.can_access_store(store_key, array['admin', 'manager', 'accountant']))
);

drop policy if exists "audit_events_insert_management" on public.audit_events;
create policy "audit_events_insert_management"
on public.audit_events
for insert
to authenticated
with check (
  actor_id = (select auth.uid())
  and (
    select public.can_access_store(
      store_key,
      array['admin', 'manager', 'accountant', 'cashier', 'employee']
    )
  )
);
-- END 202604220002_financial_audit_controls.sql

-- ================================================
-- 202604230001_shift_schedules_attendance_exceptions.sql
-- ================================================
create table if not exists public.shift_schedules (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  shift_date date not null,
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz not null,
  unpaid_break_minutes integer not null default 0,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint shift_schedules_time_sequence
    check (scheduled_end_at > scheduled_start_at),
  constraint shift_schedules_break_minutes_non_negative
    check (unpaid_break_minutes >= 0)
);

drop trigger if exists shift_schedules_set_updated_at on public.shift_schedules;
create trigger shift_schedules_set_updated_at
before update on public.shift_schedules
for each row
execute function public.set_updated_at();

create unique index if not exists shift_schedules_store_employee_date_uidx
  on public.shift_schedules (store_key, employee_id, shift_date);

create index if not exists shift_schedules_store_date_idx
  on public.shift_schedules (store_key, shift_date asc, scheduled_start_at asc);

create index if not exists shift_schedules_employee_date_idx
  on public.shift_schedules (employee_id, shift_date desc);

alter table public.shift_time_entries
  add column if not exists schedule_id uuid references public.shift_schedules (id) on delete set null;

create index if not exists shift_time_entries_schedule_id_idx
  on public.shift_time_entries (schedule_id);

create table if not exists public.attendance_exceptions (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  shift_entry_id uuid references public.shift_time_entries (id) on delete set null,
  schedule_id uuid references public.shift_schedules (id) on delete set null,
  exception_date date not null,
  exception_type text not null
    check (
      exception_type in (
        'missed_clock_in',
        'missed_clock_out',
        'late_start',
        'early_finish',
        'overtime',
        'unscheduled_shift'
      )
    ),
  status text not null default 'open'
    check (status in ('open', 'resolved', 'ignored')),
  severity text not null
    check (severity in ('info', 'warning', 'critical')),
  title text not null,
  details text not null,
  resolution_notes text,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists attendance_exceptions_set_updated_at on public.attendance_exceptions;
create trigger attendance_exceptions_set_updated_at
before update on public.attendance_exceptions
for each row
execute function public.set_updated_at();

create unique index if not exists attendance_exceptions_unique_issue_uidx
  on public.attendance_exceptions (
    store_key,
    employee_id,
    exception_date,
    exception_type
  );

create index if not exists attendance_exceptions_store_status_idx
  on public.attendance_exceptions (store_key, status, exception_date desc, created_at desc);

create index if not exists attendance_exceptions_employee_date_idx
  on public.attendance_exceptions (employee_id, exception_date desc, created_at desc);

alter table public.shift_schedules enable row level security;
alter table public.attendance_exceptions enable row level security;

drop policy if exists "shift_schedules_select_own_or_admin" on public.shift_schedules;
create policy "shift_schedules_select_own_or_admin"
on public.shift_schedules
for select
to authenticated
using (
  employee_id = (select auth.uid())
  or (
    select public.can_access_store(
      store_key,
      array['admin', 'manager', 'accountant']
    )
  )
);

drop policy if exists "shift_schedules_manage_admin" on public.shift_schedules;
create policy "shift_schedules_manage_admin"
on public.shift_schedules
for all
to authenticated
using (
  (
    select public.can_access_store(
      store_key,
      array['admin', 'manager']
    )
  )
)
with check (
  (
    select public.can_access_store(
      store_key,
      array['admin', 'manager']
    )
  )
);

drop policy if exists "attendance_exceptions_select_own_or_admin" on public.attendance_exceptions;
create policy "attendance_exceptions_select_own_or_admin"
on public.attendance_exceptions
for select
to authenticated
using (
  employee_id = (select auth.uid())
  or (
    select public.can_access_store(
      store_key,
      array['admin', 'manager', 'accountant']
    )
  )
);

drop policy if exists "attendance_exceptions_manage_admin" on public.attendance_exceptions;
create policy "attendance_exceptions_manage_admin"
on public.attendance_exceptions
for all
to authenticated
using (
  (
    select public.can_access_store(
      store_key,
      array['admin', 'manager']
    )
  )
)
with check (
  (
    select public.can_access_store(
      store_key,
      array['admin', 'manager']
    )
  )
);
-- END 202604230001_shift_schedules_attendance_exceptions.sql

-- ================================================
-- 202604230002_daily_sales_summary_breakdown.sql
-- ================================================
create table if not exists public.daily_sales_summaries (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  business_date date not null,
  gross_sales numeric(12, 2) not null default 0,
  payment_total numeric(12, 2) not null default 0,
  product_total numeric(12, 2) not null default 0,
  cash_sales numeric(12, 2) not null default 0,
  cashless_sales numeric(12, 2) not null default 0,
  line_count integer not null default 0,
  payment_breakdown jsonb not null default '{}'::jsonb,
  product_breakdown jsonb not null default '{}'::jsonb,
  reconciled boolean not null default false,
  reconciled_by uuid references public.profiles (id) on delete set null,
  reconciled_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint daily_sales_summaries_store_date_unique unique (store_key, business_date),
  constraint daily_sales_summaries_payment_breakdown_object check (jsonb_typeof(payment_breakdown) = 'object'),
  constraint daily_sales_summaries_product_breakdown_object check (jsonb_typeof(product_breakdown) = 'object')
);

drop trigger if exists daily_sales_summaries_set_updated_at on public.daily_sales_summaries;
create trigger daily_sales_summaries_set_updated_at
before update on public.daily_sales_summaries
for each row
execute function public.set_updated_at();

create table if not exists public.daily_sales_payment_lines (
  id uuid primary key default gen_random_uuid(),
  sales_summary_id uuid not null references public.daily_sales_summaries (id) on delete cascade,
  store_key text not null references public.stores (store_key) on delete restrict,
  business_date date not null,
  legacy_entry_id uuid unique references public.daily_sales_entries (id) on delete set null,
  amount numeric(12, 2) not null default 0,
  payment_method text not null,
  description text,
  employee_id uuid references public.profiles (id) on delete set null,
  reconciled boolean not null default false,
  reconciled_by uuid references public.profiles (id) on delete set null,
  reconciled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists daily_sales_payment_lines_set_updated_at on public.daily_sales_payment_lines;
create trigger daily_sales_payment_lines_set_updated_at
before update on public.daily_sales_payment_lines
for each row
execute function public.set_updated_at();

create table if not exists public.daily_sales_product_lines (
  id uuid primary key default gen_random_uuid(),
  sales_summary_id uuid not null references public.daily_sales_summaries (id) on delete cascade,
  store_key text not null references public.stores (store_key) on delete restrict,
  business_date date not null,
  legacy_entry_id uuid unique references public.daily_sales_entries (id) on delete set null,
  amount numeric(12, 2) not null default 0,
  product_type text not null,
  description text,
  employee_id uuid references public.profiles (id) on delete set null,
  reconciled boolean not null default false,
  reconciled_by uuid references public.profiles (id) on delete set null,
  reconciled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists daily_sales_product_lines_set_updated_at on public.daily_sales_product_lines;
create trigger daily_sales_product_lines_set_updated_at
before update on public.daily_sales_product_lines
for each row
execute function public.set_updated_at();

create index if not exists daily_sales_summaries_store_key_idx
  on public.daily_sales_summaries (store_key, business_date desc);

create index if not exists daily_sales_payment_lines_store_key_idx
  on public.daily_sales_payment_lines (store_key, business_date desc);

create index if not exists daily_sales_payment_lines_summary_id_idx
  on public.daily_sales_payment_lines (sales_summary_id, created_at desc);

create index if not exists daily_sales_payment_lines_method_idx
  on public.daily_sales_payment_lines (store_key, payment_method, business_date desc);

create index if not exists daily_sales_product_lines_store_key_idx
  on public.daily_sales_product_lines (store_key, business_date desc);

create index if not exists daily_sales_product_lines_summary_id_idx
  on public.daily_sales_product_lines (sales_summary_id, created_at desc);

create index if not exists daily_sales_product_lines_type_idx
  on public.daily_sales_product_lines (store_key, product_type, business_date desc);

alter table public.daily_sales_summaries enable row level security;
alter table public.daily_sales_payment_lines enable row level security;
alter table public.daily_sales_product_lines enable row level security;

drop policy if exists "daily_sales_summaries_select_staff" on public.daily_sales_summaries;
create policy "daily_sales_summaries_select_staff"
on public.daily_sales_summaries
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

drop policy if exists "daily_sales_summaries_manage_staff" on public.daily_sales_summaries;
create policy "daily_sales_summaries_manage_staff"
on public.daily_sales_summaries
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

drop policy if exists "daily_sales_payment_lines_select_staff" on public.daily_sales_payment_lines;
create policy "daily_sales_payment_lines_select_staff"
on public.daily_sales_payment_lines
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

drop policy if exists "daily_sales_payment_lines_manage_staff" on public.daily_sales_payment_lines;
create policy "daily_sales_payment_lines_manage_staff"
on public.daily_sales_payment_lines
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

drop policy if exists "daily_sales_product_lines_select_staff" on public.daily_sales_product_lines;
create policy "daily_sales_product_lines_select_staff"
on public.daily_sales_product_lines
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

drop policy if exists "daily_sales_product_lines_manage_staff" on public.daily_sales_product_lines;
create policy "daily_sales_product_lines_manage_staff"
on public.daily_sales_product_lines
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

insert into public.daily_sales_summaries (
  store_key,
  business_date,
  created_by,
  updated_by
)
select
  source.store_key,
  source.business_date,
  source.created_by,
  source.updated_by
from (
  select
    entry.store_key,
    entry.entry_date as business_date,
    (
      array_agg(entry.employee_id order by entry.created_at asc, entry.id asc)
      filter (where entry.employee_id is not null)
    )[1] as created_by,
    (
      array_agg(entry.employee_id order by entry.created_at desc, entry.id desc)
      filter (where entry.employee_id is not null)
    )[1] as updated_by
  from public.daily_sales_entries as entry
  group by entry.store_key, entry.entry_date

  union

  select
    reconciliation.store_key,
    reconciliation.reconciliation_date as business_date,
    reconciliation.reconciled_by as created_by,
    reconciliation.reconciled_by as updated_by
  from public.daily_sales_reconciliations as reconciliation
) as source
on conflict (store_key, business_date) do nothing;

insert into public.daily_sales_payment_lines (
  sales_summary_id,
  store_key,
  business_date,
  legacy_entry_id,
  amount,
  payment_method,
  description,
  employee_id,
  reconciled,
  reconciled_by,
  reconciled_at,
  created_at,
  updated_at
)
select
  summary.id,
  entry.store_key,
  entry.entry_date,
  entry.id,
  entry.amount,
  entry.payment_method,
  entry.description,
  entry.employee_id,
  entry.reconciled,
  entry.reconciled_by,
  entry.reconciled_at,
  entry.created_at,
  entry.updated_at
from public.daily_sales_entries as entry
join public.daily_sales_summaries as summary
  on summary.store_key = entry.store_key
 and summary.business_date = entry.entry_date
where entry.product_type = '__payment__'
on conflict (legacy_entry_id) do nothing;

insert into public.daily_sales_product_lines (
  sales_summary_id,
  store_key,
  business_date,
  legacy_entry_id,
  amount,
  product_type,
  description,
  employee_id,
  reconciled,
  reconciled_by,
  reconciled_at,
  created_at,
  updated_at
)
select
  summary.id,
  entry.store_key,
  entry.entry_date,
  entry.id,
  entry.amount,
  entry.product_type,
  entry.description,
  entry.employee_id,
  entry.reconciled,
  entry.reconciled_by,
  entry.reconciled_at,
  entry.created_at,
  entry.updated_at
from public.daily_sales_entries as entry
join public.daily_sales_summaries as summary
  on summary.store_key = entry.store_key
 and summary.business_date = entry.entry_date
where entry.product_type <> '__payment__'
on conflict (legacy_entry_id) do nothing;

with payment_method_totals as (
  select
    line.store_key,
    line.business_date,
    line.payment_method,
    sum(line.amount) as amount
  from public.daily_sales_payment_lines as line
  group by line.store_key, line.business_date, line.payment_method
),
payment_rollup as (
  select
    totals.store_key,
    totals.business_date,
    sum(totals.amount) as payment_total,
    sum(case when totals.payment_method = 'cash' then totals.amount else 0 end) as cash_sales,
    count(*) filter (where totals.amount <> 0) as payment_line_types,
    jsonb_object_agg(totals.payment_method, totals.amount order by totals.payment_method) as payment_breakdown
  from payment_method_totals as totals
  group by totals.store_key, totals.business_date
),
payment_line_counts as (
  select
    line.store_key,
    line.business_date,
    count(*) as payment_line_count
  from public.daily_sales_payment_lines as line
  group by line.store_key, line.business_date
),
product_type_totals as (
  select
    line.store_key,
    line.business_date,
    line.product_type,
    sum(line.amount) as amount
  from public.daily_sales_product_lines as line
  group by line.store_key, line.business_date, line.product_type
),
product_rollup as (
  select
    totals.store_key,
    totals.business_date,
    sum(totals.amount) as product_total,
    jsonb_object_agg(totals.product_type, totals.amount order by totals.product_type) as product_breakdown
  from product_type_totals as totals
  group by totals.store_key, totals.business_date
),
product_line_counts as (
  select
    line.store_key,
    line.business_date,
    count(*) as product_line_count
  from public.daily_sales_product_lines as line
  group by line.store_key, line.business_date
),
reconciliation_rollup as (
  select
    reconciliation.store_key,
    reconciliation.reconciliation_date as business_date,
    reconciliation.reconciled_by,
    reconciliation.reconciled_at
  from public.daily_sales_reconciliations as reconciliation
)
update public.daily_sales_summaries as summary
set
  payment_total = coalesce(payment_rollup.payment_total, 0),
  product_total = coalesce(product_rollup.product_total, 0),
  gross_sales = case
    when abs(coalesce(payment_rollup.payment_total, 0)) > 0.009 then coalesce(payment_rollup.payment_total, 0)
    else coalesce(product_rollup.product_total, 0)
  end,
  cash_sales = coalesce(payment_rollup.cash_sales, 0),
  cashless_sales = coalesce(payment_rollup.payment_total, 0) - coalesce(payment_rollup.cash_sales, 0),
  line_count = coalesce(payment_line_counts.payment_line_count, 0) + coalesce(product_line_counts.product_line_count, 0),
  payment_breakdown = coalesce(payment_rollup.payment_breakdown, '{}'::jsonb),
  product_breakdown = coalesce(product_rollup.product_breakdown, '{}'::jsonb),
  reconciled = reconciliation_rollup.business_date is not null,
  reconciled_by = coalesce(reconciliation_rollup.reconciled_by, summary.reconciled_by),
  reconciled_at = coalesce(reconciliation_rollup.reconciled_at, summary.reconciled_at)
from payment_rollup
full outer join product_rollup
  on product_rollup.store_key = payment_rollup.store_key
 and product_rollup.business_date = payment_rollup.business_date
left join payment_line_counts
  on payment_line_counts.store_key = coalesce(payment_rollup.store_key, product_rollup.store_key)
 and payment_line_counts.business_date = coalesce(payment_rollup.business_date, product_rollup.business_date)
left join product_line_counts
  on product_line_counts.store_key = coalesce(payment_rollup.store_key, product_rollup.store_key)
 and product_line_counts.business_date = coalesce(payment_rollup.business_date, product_rollup.business_date)
left join reconciliation_rollup
  on reconciliation_rollup.store_key = coalesce(payment_rollup.store_key, product_rollup.store_key)
 and reconciliation_rollup.business_date = coalesce(payment_rollup.business_date, product_rollup.business_date)
where summary.store_key = coalesce(payment_rollup.store_key, product_rollup.store_key)
  and summary.business_date = coalesce(payment_rollup.business_date, product_rollup.business_date);

update public.daily_sales_summaries as summary
set
  reconciled = true,
  reconciled_by = reconciliation.reconciled_by,
  reconciled_at = reconciliation.reconciled_at
from public.daily_sales_reconciliations as reconciliation
where summary.store_key = reconciliation.store_key
  and summary.business_date = reconciliation.reconciliation_date;
-- END 202604230002_daily_sales_summary_breakdown.sql

-- ================================================
-- 202604230003_remove_demo_seed_data.sql
-- ================================================
-- Remove demo data that older seed files inserted.
-- This intentionally leaves auth users and profile rows untouched to avoid
-- revoking access unexpectedly; it only removes seeded transactional records.

update public.store_settings
set business_name = 'Default Store'
where business_name = 'Harbor Mart';

create temporary table tmp_demo_sales_entry_ids (
  id uuid primary key
) on commit drop;

insert into tmp_demo_sales_entry_ids (id)
values
  ('00000000-0000-0000-0000-000000009001'::uuid),
  ('00000000-0000-0000-0000-000000009002'::uuid),
  ('00000000-0000-0000-0000-000000009003'::uuid),
  ('00000000-0000-0000-0000-000000009004'::uuid),
  ('00000000-0000-0000-0000-000000009005'::uuid),
  ('00000000-0000-0000-0000-000000009006'::uuid),
  ('00000000-0000-0000-0000-000000009007'::uuid),
  ('00000000-0000-0000-0000-000000009008'::uuid),
  ('00000000-0000-0000-0000-000000009009'::uuid),
  ('00000000-0000-0000-0000-000000009010'::uuid),
  ('00000000-0000-0000-0000-000000009011'::uuid),
  ('00000000-0000-0000-0000-000000009012'::uuid),
  ('00000000-0000-0000-0000-000000009013'::uuid),
  ('00000000-0000-0000-0000-000000009014'::uuid),
  ('00000000-0000-0000-0000-000000009015'::uuid),
  ('00000000-0000-0000-0000-000000009016'::uuid),
  ('00000000-0000-0000-0000-000000009017'::uuid),
  ('00000000-0000-0000-0000-000000009018'::uuid);

create temporary table tmp_demo_summary_targets (
  store_key text not null,
  business_date date not null,
  primary key (store_key, business_date)
) on commit drop;

insert into tmp_demo_summary_targets (store_key, business_date)
select distinct
  payment_line.store_key,
  payment_line.business_date
from public.daily_sales_payment_lines as payment_line
join tmp_demo_sales_entry_ids as demo
  on demo.id = payment_line.legacy_entry_id
union
select distinct
  product_line.store_key,
  product_line.business_date
from public.daily_sales_product_lines as product_line
join tmp_demo_sales_entry_ids as demo
  on demo.id = product_line.legacy_entry_id
union
select distinct
  sales_entry.store_key,
  sales_entry.entry_date as business_date
from public.daily_sales_entries as sales_entry
join tmp_demo_sales_entry_ids as demo
  on demo.id = sales_entry.id
union
select
  reconciliation.store_key,
  reconciliation.reconciliation_date as business_date
from public.daily_sales_reconciliations as reconciliation
where reconciliation.id = '00000000-0000-0000-0000-000000009501'::uuid;

delete from public.daily_sales_payment_lines
where legacy_entry_id in (select id from tmp_demo_sales_entry_ids);

delete from public.daily_sales_product_lines
where legacy_entry_id in (select id from tmp_demo_sales_entry_ids);

delete from public.daily_sales_reconciliations
where id = '00000000-0000-0000-0000-000000009501'::uuid;

delete from public.daily_sales_entries
where id in (select id from tmp_demo_sales_entry_ids);

delete from public.sales_order_items
where order_id in (
  '00000000-0000-0000-0000-000000005001'::uuid,
  '00000000-0000-0000-0000-000000005002'::uuid,
  '00000000-0000-0000-0000-000000005003'::uuid,
  '00000000-0000-0000-0000-000000005004'::uuid,
  '00000000-0000-0000-0000-000000005005'::uuid
);

delete from public.sales_orders
where id in (
  '00000000-0000-0000-0000-000000005001'::uuid,
  '00000000-0000-0000-0000-000000005002'::uuid,
  '00000000-0000-0000-0000-000000005003'::uuid,
  '00000000-0000-0000-0000-000000005004'::uuid,
  '00000000-0000-0000-0000-000000005005'::uuid
);

delete from public.purchase_orders
where id in (
  '00000000-0000-0000-0000-000000004001'::uuid,
  '00000000-0000-0000-0000-000000004002'::uuid,
  '00000000-0000-0000-0000-000000004003'::uuid,
  '00000000-0000-0000-0000-000000004004'::uuid
);

delete from public.vendor_payments
where id in (
  '00000000-0000-0000-0000-000000007001'::uuid,
  '00000000-0000-0000-0000-000000007002'::uuid,
  '00000000-0000-0000-0000-000000007003'::uuid,
  '00000000-0000-0000-0000-000000007004'::uuid
);

delete from public.vendor_invoices
where id in (
  '00000000-0000-0000-0000-000000006001'::uuid,
  '00000000-0000-0000-0000-000000006002'::uuid,
  '00000000-0000-0000-0000-000000006003'::uuid,
  '00000000-0000-0000-0000-000000006004'::uuid,
  '00000000-0000-0000-0000-000000006005'::uuid
);

delete from public.expense_records
where id in (
  '00000000-0000-0000-0000-000000008001'::uuid,
  '00000000-0000-0000-0000-000000008002'::uuid,
  '00000000-0000-0000-0000-000000008003'::uuid,
  '00000000-0000-0000-0000-000000008004'::uuid
);

delete from public.products
where id in (
  '00000000-0000-0000-0000-000000003001'::uuid,
  '00000000-0000-0000-0000-000000003002'::uuid,
  '00000000-0000-0000-0000-000000003003'::uuid,
  '00000000-0000-0000-0000-000000003004'::uuid,
  '00000000-0000-0000-0000-000000003005'::uuid,
  '00000000-0000-0000-0000-000000003006'::uuid
);

delete from public.customers
where id in (
  '00000000-0000-0000-0000-000000002001'::uuid,
  '00000000-0000-0000-0000-000000002002'::uuid,
  '00000000-0000-0000-0000-000000002003'::uuid,
  '00000000-0000-0000-0000-000000002004'::uuid
);

delete from public.suppliers
where id in (
  '00000000-0000-0000-0000-000000001001'::uuid,
  '00000000-0000-0000-0000-000000001002'::uuid,
  '00000000-0000-0000-0000-000000001003'::uuid,
  '00000000-0000-0000-0000-000000001004'::uuid
);

delete from public.pay_statement_deductions
where pay_statement_id in (
  select pay_statement.id
  from public.pay_statements as pay_statement
  join public.profiles as profile
    on profile.id = pay_statement.employee_id
  where profile.email = 'employee@example.com'
    and pay_statement.period_label in (
      'Apr 12 - Apr 24, 2026',
      'Apr 1 - Apr 11, 2026',
      'Mar 16 - Mar 27, 2026',
      'Mar 1 - Mar 13, 2026',
      'Feb 16 - Feb 27, 2026'
    )
);

delete from public.payroll_documents
where employee_id in (
  select id
  from public.profiles
  where email = 'employee@example.com'
)
  and period_label in (
    'Apr 12 - Apr 24, 2026',
    'Apr 1 - Apr 11, 2026',
    'Mar 16 - Mar 27, 2026',
    'Mar 1 - Mar 13, 2026',
    'Feb 16 - Feb 27, 2026'
  )
  and external_url = 'https://example.com/payroll/pay-statement.pdf';

delete from public.pay_statements
where employee_id in (
  select id
  from public.profiles
  where email = 'employee@example.com'
)
  and period_label in (
    'Apr 12 - Apr 24, 2026',
    'Apr 1 - Apr 11, 2026',
    'Mar 16 - Mar 27, 2026',
    'Mar 1 - Mar 13, 2026',
    'Feb 16 - Feb 27, 2026'
  );

with payment_totals as (
  select
    payment_line.store_key,
    payment_line.business_date,
    payment_line.payment_method,
    sum(payment_line.amount) as amount
  from public.daily_sales_payment_lines as payment_line
  join tmp_demo_summary_targets as target
    on target.store_key = payment_line.store_key
   and target.business_date = payment_line.business_date
  group by
    payment_line.store_key,
    payment_line.business_date,
    payment_line.payment_method
),
payment_rollup as (
  select
    totals.store_key,
    totals.business_date,
    sum(totals.amount) as payment_total,
    sum(case when totals.payment_method = 'cash' then totals.amount else 0 end) as cash_sales,
    jsonb_object_agg(totals.payment_method, totals.amount order by totals.payment_method) as payment_breakdown
  from payment_totals as totals
  group by totals.store_key, totals.business_date
),
payment_counts as (
  select
    payment_line.store_key,
    payment_line.business_date,
    count(*) as payment_line_count
  from public.daily_sales_payment_lines as payment_line
  join tmp_demo_summary_targets as target
    on target.store_key = payment_line.store_key
   and target.business_date = payment_line.business_date
  group by payment_line.store_key, payment_line.business_date
),
product_totals as (
  select
    product_line.store_key,
    product_line.business_date,
    product_line.product_type,
    sum(product_line.amount) as amount
  from public.daily_sales_product_lines as product_line
  join tmp_demo_summary_targets as target
    on target.store_key = product_line.store_key
   and target.business_date = product_line.business_date
  group by
    product_line.store_key,
    product_line.business_date,
    product_line.product_type
),
product_rollup as (
  select
    totals.store_key,
    totals.business_date,
    sum(totals.amount) as product_total,
    jsonb_object_agg(totals.product_type, totals.amount order by totals.product_type) as product_breakdown
  from product_totals as totals
  group by totals.store_key, totals.business_date
),
product_counts as (
  select
    product_line.store_key,
    product_line.business_date,
    count(*) as product_line_count
  from public.daily_sales_product_lines as product_line
  join tmp_demo_summary_targets as target
    on target.store_key = product_line.store_key
   and target.business_date = product_line.business_date
  group by product_line.store_key, product_line.business_date
),
reconciliation_rollup as (
  select
    reconciliation.store_key,
    reconciliation.reconciliation_date as business_date,
    true as reconciled,
    reconciliation.reconciled_by,
    reconciliation.reconciled_at
  from public.daily_sales_reconciliations as reconciliation
  join tmp_demo_summary_targets as target
    on target.store_key = reconciliation.store_key
   and target.business_date = reconciliation.reconciliation_date
),
active_targets as (
  select
    target.store_key,
    target.business_date
  from tmp_demo_summary_targets as target
  left join payment_counts
    on payment_counts.store_key = target.store_key
   and payment_counts.business_date = target.business_date
  left join product_counts
    on product_counts.store_key = target.store_key
   and product_counts.business_date = target.business_date
  left join reconciliation_rollup
    on reconciliation_rollup.store_key = target.store_key
   and reconciliation_rollup.business_date = target.business_date
  where coalesce(payment_counts.payment_line_count, 0) > 0
     or coalesce(product_counts.product_line_count, 0) > 0
     or coalesce(reconciliation_rollup.reconciled, false)
)
insert into public.daily_sales_summaries (
  store_key,
  business_date,
  gross_sales,
  payment_total,
  product_total,
  cash_sales,
  cashless_sales,
  line_count,
  payment_breakdown,
  product_breakdown,
  reconciled,
  reconciled_by,
  reconciled_at
)
select
  target.store_key,
  target.business_date,
  case
    when abs(coalesce(payment_rollup.payment_total, 0)) > 0.009 then coalesce(payment_rollup.payment_total, 0)
    else coalesce(product_rollup.product_total, 0)
  end as gross_sales,
  coalesce(payment_rollup.payment_total, 0) as payment_total,
  coalesce(product_rollup.product_total, 0) as product_total,
  coalesce(payment_rollup.cash_sales, 0) as cash_sales,
  coalesce(payment_rollup.payment_total, 0) - coalesce(payment_rollup.cash_sales, 0) as cashless_sales,
  coalesce(payment_counts.payment_line_count, 0) + coalesce(product_counts.product_line_count, 0) as line_count,
  coalesce(payment_rollup.payment_breakdown, '{}'::jsonb) as payment_breakdown,
  coalesce(product_rollup.product_breakdown, '{}'::jsonb) as product_breakdown,
  coalesce(reconciliation_rollup.reconciled, false) as reconciled,
  reconciliation_rollup.reconciled_by,
  reconciliation_rollup.reconciled_at
from active_targets as target
left join payment_rollup
  on payment_rollup.store_key = target.store_key
 and payment_rollup.business_date = target.business_date
left join payment_counts
  on payment_counts.store_key = target.store_key
 and payment_counts.business_date = target.business_date
left join product_rollup
  on product_rollup.store_key = target.store_key
 and product_rollup.business_date = target.business_date
left join product_counts
  on product_counts.store_key = target.store_key
 and product_counts.business_date = target.business_date
left join reconciliation_rollup
  on reconciliation_rollup.store_key = target.store_key
 and reconciliation_rollup.business_date = target.business_date
on conflict (store_key, business_date) do update
set
  gross_sales = excluded.gross_sales,
  payment_total = excluded.payment_total,
  product_total = excluded.product_total,
  cash_sales = excluded.cash_sales,
  cashless_sales = excluded.cashless_sales,
  line_count = excluded.line_count,
  payment_breakdown = excluded.payment_breakdown,
  product_breakdown = excluded.product_breakdown,
  reconciled = excluded.reconciled,
  reconciled_by = excluded.reconciled_by,
  reconciled_at = excluded.reconciled_at;

delete from public.daily_sales_summaries as summary
where exists (
  select 1
  from tmp_demo_summary_targets as target
  where target.store_key = summary.store_key
    and target.business_date = summary.business_date
)
  and not exists (
    select 1
    from public.daily_sales_payment_lines as payment_line
    where payment_line.store_key = summary.store_key
      and payment_line.business_date = summary.business_date
  )
  and not exists (
    select 1
    from public.daily_sales_product_lines as product_line
    where product_line.store_key = summary.store_key
      and product_line.business_date = summary.business_date
  )
  and not exists (
    select 1
    from public.daily_sales_reconciliations as reconciliation
    where reconciliation.store_key = summary.store_key
      and reconciliation.reconciliation_date = summary.business_date
  );
-- END 202604230003_remove_demo_seed_data.sql

-- 202605010001_payroll_payment_method_and_till_defaults.sql
alter table public.pay_statements
  add column if not exists payment_method text not null default 'direct_deposit';

alter table public.pay_statements
  drop constraint if exists pay_statements_payment_method_check;

alter table public.pay_statements
  add constraint pay_statements_payment_method_check
  check (
    payment_method in (
      'direct_deposit',
      'check',
      'cash',
      'bank_transfer',
      'payroll_card',
      'other'
    )
  );

create index if not exists pay_statements_store_key_payment_method_idx
  on public.pay_statements (store_key, payment_method, pay_date desc);

alter table public.store_settings
  add column if not exists till_opening_float numeric(12, 2) not null default 500;

alter table public.store_settings
  add column if not exists till_closing_float numeric(12, 2) not null default 500;

alter table public.store_settings
  drop constraint if exists store_settings_till_opening_float_check;

alter table public.store_settings
  add constraint store_settings_till_opening_float_check
  check (till_opening_float >= 0);

alter table public.store_settings
  drop constraint if exists store_settings_till_closing_float_check;

alter table public.store_settings
  add constraint store_settings_till_closing_float_check
  check (till_closing_float >= 0);
-- END 202605010001_payroll_payment_method_and_till_defaults.sql

-- BEGIN 202605010002_cash_vault_transactions.sql
create table if not exists public.cash_vault_transactions (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  source_table text not null,
  source_id uuid not null,
  movement_type text not null check (
    movement_type in (
      'cash_sale',
      'sales_payout',
      'cash_expense',
      'vendor_payment_cash',
      'payroll_cash',
      'bank_deposit'
    )
  ),
  business_date date not null,
  amount numeric(12, 2) not null,
  details text not null,
  metadata jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists cash_vault_transactions_source_unique_idx
  on public.cash_vault_transactions (source_table, source_id, movement_type);

create index if not exists cash_vault_transactions_store_key_recorded_at_idx
  on public.cash_vault_transactions (store_key, recorded_at desc, business_date desc);

alter table public.cash_vault_transactions enable row level security;

drop trigger if exists cash_vault_transactions_set_updated_at on public.cash_vault_transactions;
create trigger cash_vault_transactions_set_updated_at
before update on public.cash_vault_transactions
for each row
execute function public.set_updated_at();

drop policy if exists "cash_vault_transactions_select_management" on public.cash_vault_transactions;
create policy "cash_vault_transactions_select_management"
on public.cash_vault_transactions
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

create or replace function public.delete_cash_vault_transaction(
  p_source_table text,
  p_source_id uuid,
  p_movement_type text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.cash_vault_transactions
  where source_table = p_source_table
    and source_id = p_source_id
    and movement_type = p_movement_type;
end;
$$;

create or replace function public.upsert_cash_vault_transaction(
  p_store_key text,
  p_source_table text,
  p_source_id uuid,
  p_movement_type text,
  p_business_date date,
  p_amount numeric,
  p_details text,
  p_recorded_at timestamptz,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_store_key is null or p_source_id is null or coalesce(p_amount, 0) = 0 then
    perform public.delete_cash_vault_transaction(
      p_source_table,
      p_source_id,
      p_movement_type
    );
    return;
  end if;

  insert into public.cash_vault_transactions (
    store_key,
    source_table,
    source_id,
    movement_type,
    business_date,
    amount,
    details,
    metadata,
    recorded_at
  )
  values (
    p_store_key,
    p_source_table,
    p_source_id,
    p_movement_type,
    p_business_date,
    round(p_amount::numeric, 2),
    coalesce(nullif(btrim(p_details), ''), 'Cash movement logged'),
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_recorded_at, timezone('utc', now()))
  )
  on conflict (source_table, source_id, movement_type)
  do update set
    store_key = excluded.store_key,
    business_date = excluded.business_date,
    amount = excluded.amount,
    details = excluded.details,
    metadata = excluded.metadata,
    recorded_at = excluded.recorded_at,
    updated_at = timezone('utc', now());
end;
$$;

create or replace function public.sync_cash_vault_from_sales_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'daily_sales_summaries',
      old.id,
      'cash_sale'
    );
    return old;
  end if;

  if coalesce(new.cash_sales, 0) > 0 then
    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'daily_sales_summaries',
      new.id,
      'cash_sale',
      new.business_date,
      new.cash_sales,
      case
        when coalesce(new.line_count, 0) > 0
          then concat(new.line_count, ' sales lines logged as cash')
        else 'Cash sales recorded'
      end,
      coalesce(new.updated_at, new.created_at, timezone('utc', now())),
      jsonb_build_object(
        'cashSales', new.cash_sales,
        'lineCount', coalesce(new.line_count, 0),
        'reconciled', new.reconciled
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'daily_sales_summaries',
      new.id,
      'cash_sale'
    );
  end if;

  return new;
end;
$$;

create or replace function public.sync_cash_vault_from_sales_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'daily_sales_reconciliations',
      old.id,
      'sales_payout'
    );
    return old;
  end if;

  if new.status = 'approved' and coalesce(new.total_payouts, 0) > 0 then
    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'daily_sales_reconciliations',
      new.id,
      'sales_payout',
      new.reconciliation_date,
      new.total_payouts * -1,
      coalesce(
        nullif(btrim(new.notes), ''),
        'Sales payout recorded during closeout'
      ),
      coalesce(
        new.reconciled_at,
        new.updated_at,
        new.created_at,
        timezone('utc', now())
      ),
      jsonb_build_object(
        'status', new.status,
        'totalPayouts', new.total_payouts,
        'variance', new.variance
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'daily_sales_reconciliations',
      new.id,
      'sales_payout'
    );
  end if;

  return new;
end;
$$;

create or replace function public.sync_cash_vault_from_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'expense_records',
      old.id,
      'cash_expense'
    );
    return old;
  end if;

  if new.status = 'approved'
    and lower(coalesce(new.payment_method, '')) = 'cash'
    and coalesce(new.amount, 0) > 0
  then
    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'expense_records',
      new.id,
      'cash_expense',
      new.expense_date,
      new.amount * -1,
      concat_ws(
        ': ',
        nullif(btrim(new.category), ''),
        nullif(btrim(new.description), '')
      ),
      coalesce(new.approved_at, new.updated_at, new.created_at, timezone('utc', now())),
      jsonb_build_object(
        'category', new.category,
        'paymentMethod', new.payment_method,
        'status', new.status,
        'vendorName', new.vendor_name
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'expense_records',
      new.id,
      'cash_expense'
    );
  end if;

  return new;
end;
$$;

create or replace function public.sync_cash_vault_from_vendor_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  supplier_name text;
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'vendor_payments',
      old.id,
      'vendor_payment_cash'
    );
    return old;
  end if;

  if new.status = 'posted'
    and lower(coalesce(new.payment_method, '')) = 'cash'
    and coalesce(new.amount_paid, 0) > 0
  then
    select suppliers.name
    into supplier_name
    from public.suppliers
    where suppliers.id = new.supplier_id;

    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'vendor_payments',
      new.id,
      'vendor_payment_cash',
      new.payment_date,
      new.amount_paid * -1,
      concat_ws(
        ' · ',
        coalesce(nullif(btrim(supplier_name), ''), 'Vendor payment'),
        nullif(btrim(new.reference_number), '')
      ),
      coalesce(new.approved_at, new.updated_at, new.created_at, timezone('utc', now())),
      jsonb_build_object(
        'supplierId', new.supplier_id,
        'invoiceId', new.vendor_invoice_id,
        'referenceNumber', new.reference_number,
        'paymentMethod', new.payment_method,
        'status', new.status
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'vendor_payments',
      new.id,
      'vendor_payment_cash'
    );
  end if;

  return new;
end;
$$;

create or replace function public.sync_cash_vault_from_pay_statement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_label text;
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'pay_statements',
      old.id,
      'payroll_cash'
    );
    return old;
  end if;

  if new.status = 'paid'
    and lower(coalesce(new.payment_method, '')) = 'cash'
    and coalesce(new.net_pay, 0) > 0
  then
    select coalesce(nullif(btrim(profiles.full_name), ''), nullif(btrim(profiles.email), ''), 'Payroll')
    into employee_label
    from public.profiles
    where profiles.id = new.employee_id;

    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'pay_statements',
      new.id,
      'payroll_cash',
      new.pay_date,
      new.net_pay * -1,
      concat_ws(
        ' · ',
        coalesce(employee_label, 'Payroll'),
        nullif(btrim(new.period_label), '')
      ),
      coalesce(new.updated_at, new.created_at, timezone('utc', now())),
      jsonb_build_object(
        'employeeId', new.employee_id,
        'periodLabel', new.period_label,
        'paymentMethod', new.payment_method,
        'status', new.status
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'pay_statements',
      new.id,
      'payroll_cash'
    );
  end if;

  return new;
end;
$$;

create or replace function public.sync_cash_vault_from_bank_deposit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'bank_deposits',
      old.id,
      'bank_deposit'
    );
    return old;
  end if;

  if coalesce(new.amount, 0) > 0 then
    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'bank_deposits',
      new.id,
      'bank_deposit',
      new.deposit_date,
      new.amount * -1,
      coalesce(nullif(btrim(new.notes), ''), 'Deposit posted to bank'),
      coalesce(new.updated_at, new.created_at, timezone('utc', now())),
      jsonb_build_object(
        'createdBy', new.created_by,
        'slipPhotoUrl', new.slip_photo_url
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'bank_deposits',
      new.id,
      'bank_deposit'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists daily_sales_summaries_sync_cash_vault on public.daily_sales_summaries;
create trigger daily_sales_summaries_sync_cash_vault
after insert or update or delete on public.daily_sales_summaries
for each row
execute function public.sync_cash_vault_from_sales_summary();

drop trigger if exists daily_sales_reconciliations_sync_cash_vault on public.daily_sales_reconciliations;
create trigger daily_sales_reconciliations_sync_cash_vault
after insert or update or delete on public.daily_sales_reconciliations
for each row
execute function public.sync_cash_vault_from_sales_reconciliation();

drop trigger if exists expense_records_sync_cash_vault on public.expense_records;
create trigger expense_records_sync_cash_vault
after insert or update or delete on public.expense_records
for each row
execute function public.sync_cash_vault_from_expense();

drop trigger if exists vendor_payments_sync_cash_vault on public.vendor_payments;
create trigger vendor_payments_sync_cash_vault
after insert or update or delete on public.vendor_payments
for each row
execute function public.sync_cash_vault_from_vendor_payment();

drop trigger if exists pay_statements_sync_cash_vault on public.pay_statements;
create trigger pay_statements_sync_cash_vault
after insert or update or delete on public.pay_statements
for each row
execute function public.sync_cash_vault_from_pay_statement();

drop trigger if exists bank_deposits_sync_cash_vault on public.bank_deposits;
create trigger bank_deposits_sync_cash_vault
after insert or update or delete on public.bank_deposits
for each row
execute function public.sync_cash_vault_from_bank_deposit();

delete from public.cash_vault_transactions
where source_table in (
  'daily_sales_summaries',
  'daily_sales_reconciliations',
  'expense_records',
  'vendor_payments',
  'pay_statements',
  'bank_deposits'
);

insert into public.cash_vault_transactions (
  store_key,
  source_table,
  source_id,
  movement_type,
  business_date,
  amount,
  details,
  metadata,
  recorded_at
)
select
  summary.store_key,
  'daily_sales_summaries',
  summary.id,
  'cash_sale',
  summary.business_date,
  round(summary.cash_sales::numeric, 2),
  case
    when coalesce(summary.line_count, 0) > 0
      then concat(summary.line_count, ' sales lines logged as cash')
    else 'Cash sales recorded'
  end,
  jsonb_build_object(
    'cashSales', summary.cash_sales,
    'lineCount', coalesce(summary.line_count, 0),
    'reconciled', summary.reconciled
  ),
  coalesce(summary.updated_at, summary.created_at, timezone('utc', now()))
from public.daily_sales_summaries as summary
where coalesce(summary.cash_sales, 0) > 0;

insert into public.cash_vault_transactions (
  store_key,
  source_table,
  source_id,
  movement_type,
  business_date,
  amount,
  details,
  metadata,
  recorded_at
)
select
  reconciliation.store_key,
  'daily_sales_reconciliations',
  reconciliation.id,
  'sales_payout',
  reconciliation.reconciliation_date,
  round((reconciliation.total_payouts * -1)::numeric, 2),
  coalesce(
    nullif(btrim(reconciliation.notes), ''),
    'Sales payout recorded during closeout'
  ),
  jsonb_build_object(
    'status', reconciliation.status,
    'totalPayouts', reconciliation.total_payouts,
    'variance', reconciliation.variance
  ),
  coalesce(
    reconciliation.reconciled_at,
    reconciliation.updated_at,
    reconciliation.created_at,
    timezone('utc', now())
  )
from public.daily_sales_reconciliations as reconciliation
where reconciliation.status = 'approved'
  and coalesce(reconciliation.total_payouts, 0) > 0;

insert into public.cash_vault_transactions (
  store_key,
  source_table,
  source_id,
  movement_type,
  business_date,
  amount,
  details,
  metadata,
  recorded_at
)
select
  expense.store_key,
  'expense_records',
  expense.id,
  'cash_expense',
  expense.expense_date,
  round((expense.amount * -1)::numeric, 2),
  concat_ws(
    ': ',
    nullif(btrim(expense.category), ''),
    nullif(btrim(expense.description), '')
  ),
  jsonb_build_object(
    'category', expense.category,
    'paymentMethod', expense.payment_method,
    'status', expense.status,
    'vendorName', expense.vendor_name
  ),
  coalesce(expense.approved_at, expense.updated_at, expense.created_at, timezone('utc', now()))
from public.expense_records as expense
where expense.status = 'approved'
  and lower(coalesce(expense.payment_method, '')) = 'cash'
  and coalesce(expense.amount, 0) > 0;

insert into public.cash_vault_transactions (
  store_key,
  source_table,
  source_id,
  movement_type,
  business_date,
  amount,
  details,
  metadata,
  recorded_at
)
select
  payment.store_key,
  'vendor_payments',
  payment.id,
  'vendor_payment_cash',
  payment.payment_date,
  round((payment.amount_paid * -1)::numeric, 2),
  concat_ws(
    ' · ',
    coalesce(nullif(btrim(supplier.name), ''), 'Vendor payment'),
    nullif(btrim(payment.reference_number), '')
  ),
  jsonb_build_object(
    'supplierId', payment.supplier_id,
    'invoiceId', payment.vendor_invoice_id,
    'referenceNumber', payment.reference_number,
    'paymentMethod', payment.payment_method,
    'status', payment.status
  ),
  coalesce(payment.approved_at, payment.updated_at, payment.created_at, timezone('utc', now()))
from public.vendor_payments as payment
left join public.suppliers as supplier
  on supplier.id = payment.supplier_id
where payment.status = 'posted'
  and lower(coalesce(payment.payment_method, '')) = 'cash'
  and coalesce(payment.amount_paid, 0) > 0;

insert into public.cash_vault_transactions (
  store_key,
  source_table,
  source_id,
  movement_type,
  business_date,
  amount,
  details,
  metadata,
  recorded_at
)
select
  statement.store_key,
  'pay_statements',
  statement.id,
  'payroll_cash',
  statement.pay_date,
  round((statement.net_pay * -1)::numeric, 2),
  concat_ws(
    ' · ',
    coalesce(
      nullif(btrim(profile.full_name), ''),
      nullif(btrim(profile.email), ''),
      'Payroll'
    ),
    nullif(btrim(statement.period_label), '')
  ),
  jsonb_build_object(
    'employeeId', statement.employee_id,
    'periodLabel', statement.period_label,
    'paymentMethod', statement.payment_method,
    'status', statement.status
  ),
  coalesce(statement.updated_at, statement.created_at, timezone('utc', now()))
from public.pay_statements as statement
left join public.profiles as profile
  on profile.id = statement.employee_id
where statement.status = 'paid'
  and lower(coalesce(statement.payment_method, '')) = 'cash'
  and coalesce(statement.net_pay, 0) > 0;

insert into public.cash_vault_transactions (
  store_key,
  source_table,
  source_id,
  movement_type,
  business_date,
  amount,
  details,
  metadata,
  recorded_at
)
select
  deposit.store_key,
  'bank_deposits',
  deposit.id,
  'bank_deposit',
  deposit.deposit_date,
  round((deposit.amount * -1)::numeric, 2),
  coalesce(nullif(btrim(deposit.notes), ''), 'Deposit posted to bank'),
  jsonb_build_object(
    'createdBy', deposit.created_by,
    'slipPhotoUrl', deposit.slip_photo_url
  ),
  coalesce(deposit.updated_at, deposit.created_at, timezone('utc', now()))
from public.bank_deposits as deposit
where coalesce(deposit.amount, 0) > 0;
-- END 202605010002_cash_vault_transactions.sql

-- ================================================
-- 202605080002_expense_document_support.sql
-- ================================================
alter table public.expense_records
  add column if not exists attachment_name text,
  add column if not exists attachment_path text,
  add column if not exists attachment_url text,
  add column if not exists attachment_mime_type text;

insert into storage.buckets (id, name, public)
values ('expense-documents', 'expense-documents', false)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "expense_document_storage_select_management" on storage.objects;
create policy "expense_document_storage_select_management"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'expense-documents'
  and (select public.is_current_user_role(array['admin', 'manager']))
);

drop policy if exists "expense_document_storage_insert_management" on storage.objects;
create policy "expense_document_storage_insert_management"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'expense-documents'
  and (select public.is_current_user_role(array['admin', 'manager']))
);

drop policy if exists "expense_document_storage_update_management" on storage.objects;
create policy "expense_document_storage_update_management"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'expense-documents'
  and (select public.is_current_user_role(array['admin', 'manager']))
)
with check (
  bucket_id = 'expense-documents'
  and (select public.is_current_user_role(array['admin', 'manager']))
);

drop policy if exists "expense_document_storage_delete_management" on storage.objects;
create policy "expense_document_storage_delete_management"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'expense-documents'
  and (select public.is_current_user_role(array['admin', 'manager']))
);
-- END 202605080002_expense_document_support.sql

-- ================================================
-- 202605080003_secure_expense_documents_and_normalize_categories.sql
-- ================================================
insert into storage.buckets (id, name, public)
values ('expense-documents', 'expense-documents', false)
on conflict (id) do update
set public = excluded.public;

update public.expense_records
set attachment_url = null
where attachment_url is not null;

update public.expense_records
set category = case
  when btrim(category) = '' then 'Other'
  when lower(btrim(category)) ~ '^(utilities|utility|utility bill|electric|electricity|power|water|sewer|trash|garbage|waste|internet|phone|telecom|gas)$'
    then 'Utilities'
  when lower(btrim(category)) ~ '^(rent|lease)$'
    then 'Rent'
  when lower(regexp_replace(btrim(category), '[^a-z0-9]+', ' ', 'gi')) ~ '^(repairs|repair|maintenance|repairs maintenance|repairs and maintenance)$'
    then 'Repairs & Maintenance'
  when lower(btrim(category)) ~ '^(supplies|supply)$'
    then 'Supplies'
  when lower(btrim(category)) = 'fuel'
    then 'Fuel'
  when lower(btrim(category)) = 'insurance'
    then 'Insurance'
  when lower(regexp_replace(btrim(category), '[^a-z0-9]+', ' ', 'gi')) ~ '^(tax|taxes|license|licenses|permit|permits)$'
    then 'Taxes & Licenses'
  when lower(btrim(category)) ~ '^(cleaning|janitorial)$'
    then 'Cleaning'
  when lower(regexp_replace(btrim(category), '[^a-z0-9]+', ' ', 'gi')) ~ '^(contract labor|contractor labor|labor|contractors)$'
    then 'Contract Labor'
  when lower(btrim(category)) = 'other'
    then 'Other'
  else initcap(regexp_replace(btrim(category), '\s+', ' ', 'g'))
end
where category is not null;
-- END 202605080003_secure_expense_documents_and_normalize_categories.sql

-- ================================================
-- 202605080004_expense_review_notes.sql
-- ================================================
alter table public.expense_records
  add column if not exists approval_note text,
  add column if not exists void_note text;
-- END 202605080004_expense_review_notes.sql

-- ================================================
-- 202605080005_recurring_expense_templates.sql
-- ================================================
create table if not exists public.recurring_expense_templates (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  category text not null,
  default_amount numeric(12, 2) not null check (default_amount > 0),
  description text not null,
  due_day_of_month integer not null check (due_day_of_month between 1 and 31),
  vendor_name text,
  payment_method text
    check (payment_method in ('cash', 'card', 'mobile', 'bank_transfer', 'check', 'other')),
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists recurring_expense_templates_set_updated_at on public.recurring_expense_templates;
create trigger recurring_expense_templates_set_updated_at
before update on public.recurring_expense_templates
for each row
execute function public.set_updated_at();

alter table public.recurring_expense_templates enable row level security;

drop policy if exists "recurring_expense_templates_select_management" on public.recurring_expense_templates;
create policy "recurring_expense_templates_select_management"
on public.recurring_expense_templates
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "recurring_expense_templates_manage_management" on public.recurring_expense_templates;
create policy "recurring_expense_templates_manage_management"
on public.recurring_expense_templates
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

create index if not exists recurring_expense_templates_store_key_active_due_day_idx
  on public.recurring_expense_templates (store_key, active, due_day_of_month, description);

alter table public.expense_records
  add column if not exists recurring_template_id uuid references public.recurring_expense_templates (id) on delete set null,
  add column if not exists recurring_period_month date;

create index if not exists expense_records_store_key_recurring_template_period_idx
  on public.expense_records (store_key, recurring_template_id, recurring_period_month desc)
  where recurring_template_id is not null
    and recurring_period_month is not null;

create unique index if not exists expense_records_store_key_recurring_template_period_active_uniq
  on public.expense_records (store_key, recurring_template_id, recurring_period_month)
  where recurring_template_id is not null
    and recurring_period_month is not null
    and status in ('draft', 'approved');
-- END 202605080005_recurring_expense_templates.sql

-- ================================================
-- 202605080006_expense_category_budgets.sql
-- ================================================
create table if not exists public.expense_category_budgets (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  budget_month date not null,
  category text not null,
  budget_amount numeric(12, 2) not null check (budget_amount > 0),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint expense_category_budgets_month_start_check
    check (date_trunc('month', budget_month)::date = budget_month)
);

drop trigger if exists expense_category_budgets_set_updated_at on public.expense_category_budgets;
create trigger expense_category_budgets_set_updated_at
before update on public.expense_category_budgets
for each row
execute function public.set_updated_at();

alter table public.expense_category_budgets enable row level security;

drop policy if exists "expense_category_budgets_select_management" on public.expense_category_budgets;
create policy "expense_category_budgets_select_management"
on public.expense_category_budgets
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "expense_category_budgets_manage_management" on public.expense_category_budgets;
create policy "expense_category_budgets_manage_management"
on public.expense_category_budgets
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

create unique index if not exists expense_category_budgets_store_key_month_category_uniq
  on public.expense_category_budgets (store_key, budget_month, category);

create index if not exists expense_category_budgets_store_key_month_idx
  on public.expense_category_budgets (store_key, budget_month desc, category);
-- END 202605080006_expense_category_budgets.sql

-- ================================================
-- 202605190004_security_financial_hardening.sql
-- ================================================
alter table public.vendor_invoices
  add column if not exists pdf_file_name text,
  add column if not exists pdf_path text,
  add column if not exists pdf_mime_type text;

update public.vendor_invoices
set
  pdf_path = coalesce(
    pdf_path,
    nullif(
      split_part(pdf_url, '/storage/v1/object/public/vendor-invoices/', 2),
      ''
    )
  ),
  pdf_file_name = coalesce(
    pdf_file_name,
    nullif(
      regexp_replace(
        split_part(pdf_url, '/storage/v1/object/public/vendor-invoices/', 2),
        '^.*/',
        ''
      ),
      ''
    )
  )
where pdf_url like '%/storage/v1/object/public/vendor-invoices/%';

update public.vendor_invoices
set pdf_url = null
where pdf_path is not null
  and pdf_url like '%/storage/v1/object/%/vendor-invoices/%';

insert into storage.buckets (id, name, public)
values ('vendor-invoices', 'vendor-invoices', false)
on conflict (id) do update
set public = false;

update public.vendor_adjustments
set
  attachment_path = coalesce(
    attachment_path,
    nullif(
      split_part(attachment_url, '/storage/v1/object/public/vendor-invoices/', 2),
      ''
    )
  )
where attachment_url like '%/storage/v1/object/public/vendor-invoices/%';

update public.vendor_adjustments
set attachment_url = null
where attachment_path is not null
  and attachment_url like '%/storage/v1/object/%/vendor-invoices/%';

create table if not exists public.private_admin_login_attempts (
  attempt_key text primary key,
  attempt_count integer not null default 0,
  blocked_until timestamptz,
  reset_at timestamptz not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists private_admin_login_attempts_reset_idx
  on public.private_admin_login_attempts (reset_at);

alter table public.private_admin_login_attempts enable row level security;

create table if not exists public.private_admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  result text not null check (result in ('success', 'failure', 'blocked')),
  target_type text,
  target_id text,
  target_store_key text,
  token_hash text,
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists private_admin_audit_events_created_idx
  on public.private_admin_audit_events (created_at desc);

create index if not exists private_admin_audit_events_target_idx
  on public.private_admin_audit_events (target_type, target_id, created_at desc);

create index if not exists private_admin_audit_events_store_idx
  on public.private_admin_audit_events (target_store_key, created_at desc);

alter table public.private_admin_audit_events enable row level security;

drop policy if exists "private_admin_audit_events_select_admin" on public.private_admin_audit_events;
create policy "private_admin_audit_events_select_admin"
on public.private_admin_audit_events
for select
to authenticated
using ((select public.is_current_user_role(array['admin'])));

create or replace function public.prevent_closed_accounting_period_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  close_through date;
  date_column text := tg_argv[0];
  entry_date date;
  row_data jsonb;
  row_store_key text;
begin
  if (select auth.role()) = 'service_role' then
    if tg_op = 'DELETE' then
      return old;
    end if;

    return new;
  end if;

  if date_column is null or date_column = '' then
    raise exception 'Accounting lock trigger requires a date column'
      using errcode = '22023';
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    row_data := to_jsonb(old);
    row_store_key := row_data ->> 'store_key';

    if row_store_key is not null and row_store_key <> '' then
      begin
        entry_date := nullif(row_data ->> date_column, '')::date;
      exception when others then
        entry_date := null;
      end;

      if entry_date is not null then
        select accounting_close_through
        into close_through
        from public.store_settings
        where store_key = row_store_key;

        if close_through is not null and entry_date <= close_through then
          raise exception '% for % is in a closed accounting period through %',
            tg_table_name,
            entry_date,
            close_through
            using errcode = 'P0001';
        end if;
      end if;
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    row_data := to_jsonb(new);
    row_store_key := row_data ->> 'store_key';

    if row_store_key is not null and row_store_key <> '' then
      begin
        entry_date := nullif(row_data ->> date_column, '')::date;
      exception when others then
        entry_date := null;
      end;

      if entry_date is not null then
        select accounting_close_through
        into close_through
        from public.store_settings
        where store_key = row_store_key;

        if close_through is not null and entry_date <= close_through then
          raise exception '% for % is in a closed accounting period through %',
            tg_table_name,
            entry_date,
            close_through
            using errcode = 'P0001';
        end if;
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists bank_deposits_accounting_period_lock on public.bank_deposits;
create trigger bank_deposits_accounting_period_lock
before insert or update or delete on public.bank_deposits
for each row execute function public.prevent_closed_accounting_period_changes('deposit_date');

drop trigger if exists daily_sales_payment_lines_accounting_period_lock on public.daily_sales_payment_lines;
create trigger daily_sales_payment_lines_accounting_period_lock
before insert or update or delete on public.daily_sales_payment_lines
for each row execute function public.prevent_closed_accounting_period_changes('business_date');

drop trigger if exists daily_sales_product_lines_accounting_period_lock on public.daily_sales_product_lines;
create trigger daily_sales_product_lines_accounting_period_lock
before insert or update or delete on public.daily_sales_product_lines
for each row execute function public.prevent_closed_accounting_period_changes('business_date');

drop trigger if exists daily_sales_reconciliations_accounting_period_lock on public.daily_sales_reconciliations;
create trigger daily_sales_reconciliations_accounting_period_lock
before insert or update or delete on public.daily_sales_reconciliations
for each row execute function public.prevent_closed_accounting_period_changes('reconciliation_date');

drop trigger if exists daily_audits_accounting_period_lock on public.daily_audits;
create trigger daily_audits_accounting_period_lock
before insert or update or delete on public.daily_audits
for each row execute function public.prevent_closed_accounting_period_changes('audit_date');

drop trigger if exists terminal_reports_accounting_period_lock on public.terminal_reports;
create trigger terminal_reports_accounting_period_lock
before insert or update or delete on public.terminal_reports
for each row execute function public.prevent_closed_accounting_period_changes('report_date');

drop trigger if exists eod_reconciliation_accounting_period_lock on public.eod_reconciliation;
create trigger eod_reconciliation_accounting_period_lock
before insert or update or delete on public.eod_reconciliation
for each row execute function public.prevent_closed_accounting_period_changes('report_date');

drop trigger if exists lottery_eft_weekly_status_accounting_period_lock on public.lottery_eft_weekly_status;
create trigger lottery_eft_weekly_status_accounting_period_lock
before insert or update or delete on public.lottery_eft_weekly_status
for each row execute function public.prevent_closed_accounting_period_changes('week_end_date');
-- END 202605190004_security_financial_hardening.sql

-- ================================================
-- 202605190005_lottery_eod_starting_float.sql
-- ================================================
alter table public.eod_reconciliation
  add column if not exists opening_cash_float numeric(12, 2) not null default 0,
  add column if not exists closing_cash_float numeric(12, 2) not null default 0;

alter table public.eod_reconciliation
  drop constraint if exists eod_reconciliation_cash_float_check;

alter table public.eod_reconciliation
  add constraint eod_reconciliation_cash_float_check
  check (opening_cash_float >= 0 and closing_cash_float >= 0);

create or replace function public.save_lottery_eod_cash_floats(
  target_store_key text,
  target_report_date date,
  cash_opening_float numeric default 0,
  cash_closing_float numeric default 0,
  cash_total_expected numeric default 0,
  cash_till_total numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  scratch_sales_total numeric(12, 2);
  terminal_cash_total numeric(12, 2);
  recalculated_expected_cash numeric(12, 2);
begin
  if not (
    select public.can_access_store(
      target_store_key,
      array['admin', 'manager', 'accountant', 'cashier']
    )
  ) then
    raise exception 'Forbidden: lottery reconciliation is not available for this store'
      using errcode = '42501';
  end if;

  if target_report_date is null then
    raise exception 'Report date is required'
      using errcode = '22023';
  end if;

  if cash_opening_float < 0
    or cash_closing_float < 0
    or cash_total_expected < 0
    or cash_till_total < 0
  then
    raise exception 'Lottery reconciliation amounts must be zero or greater'
      using errcode = '22023';
  end if;

  select coalesce(sum(calculated_revenue), 0)::numeric(12, 2)
  into scratch_sales_total
  from public.daily_audits
  where store_key = target_store_key
    and audit_date = target_report_date;

  select coalesce(
    sum(
      draw_sales
      - draw_payouts
      - scratch_payouts
      - total_cashing_bonus
      - total_cancels
    ),
    0
  )::numeric(12, 2)
  into terminal_cash_total
  from public.terminal_reports
  where store_key = target_store_key
    and report_date = target_report_date;

  recalculated_expected_cash := round(
    greatest(
      round(cash_opening_float, 2) + scratch_sales_total + terminal_cash_total,
      0
    ),
    2
  );

  update public.eod_reconciliation reconciliation
  set
    opening_cash_float = round(cash_opening_float, 2),
    closing_cash_float = 0,
    total_expected_cash = recalculated_expected_cash,
    pos_register_total = round(cash_till_total, 2),
    updated_at = timezone('utc', now())
  where reconciliation.store_key = target_store_key
    and reconciliation.report_date = target_report_date;

  if not found then
    raise exception 'Lottery EOD reconciliation was not found for % on %',
      target_store_key,
      target_report_date
      using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.save_lottery_eod_cash_floats(
  text,
  date,
  numeric,
  numeric,
  numeric,
  numeric
) from public;

grant execute on function public.save_lottery_eod_cash_floats(
  text,
  date,
  numeric,
  numeric,
  numeric,
  numeric
) to authenticated;
-- END 202605190005_lottery_eod_starting_float.sql

-- ================================================
-- 202605200001_lottery_cash_in_hand_excludes_float.sql
-- ================================================
alter table public.eod_reconciliation
  add column if not exists opening_cash_float numeric(12, 2) not null default 0;

create or replace function public.get_lottery_cash_in_hand_summary(
  p_store_key text,
  p_end_date date,
  p_latest_sweep_date date,
  p_retailer_commission_rate numeric default 0,
  p_payout_commission_rate numeric default 0
)
returns table (
  cash_after_eft numeric,
  cash_available_before_paid_eft numeric,
  paid_eft_total numeric,
  paid_eft_weeks integer,
  recorded_days integer
)
language sql
stable
as $$
  with normalized_rates as (
    select
      least(greatest(coalesce(p_retailer_commission_rate, 0), 0), 100) / 100 as retailer_rate,
      least(greatest(coalesce(p_payout_commission_rate, 0), 0), 100) / 100 as payout_rate
  ),
  report_dates as (
    select audit_date as report_date
    from public.daily_audits
    where store_key = p_store_key
      and audit_date <= p_end_date
    union
    select report_date
    from public.terminal_reports
    where store_key = p_store_key
      and report_date <= p_end_date
    union
    select report_date
    from public.eod_reconciliation
    where store_key = p_store_key
      and report_date <= p_end_date
  ),
  audit_by_date as (
    select
      audit_date as report_date,
      round(sum(coalesce(calculated_revenue, 0))::numeric, 2) as scratch_sales
    from public.daily_audits
    where store_key = p_store_key
      and audit_date <= p_end_date
    group by audit_date
  ),
  terminal_by_date as (
    select
      report_date,
      round(coalesce(draw_sales, 0)::numeric, 2) as draw_sales,
      round(coalesce(draw_payouts, 0)::numeric, 2) as draw_payouts,
      round(coalesce(scratch_payouts, 0)::numeric, 2) as scratch_payouts,
      round(coalesce(total_cashing_bonus, 0)::numeric, 2) as promo_credits,
      round(coalesce(total_cancels, 0)::numeric, 2) as ticket_cancels,
      round(coalesce(lottery_bonding_fee, 0)::numeric, 2) as bonding_fee
    from public.terminal_reports
    where store_key = p_store_key
      and report_date <= p_end_date
  ),
  reconciliation_by_date as (
    select
      report_date,
      round(
        greatest(
          coalesce(pos_register_total, 0)::numeric -
          coalesce(opening_cash_float, 0)::numeric,
          0
        ),
        2
      ) as cash_counted
    from public.eod_reconciliation
    where store_key = p_store_key
      and report_date <= p_end_date
  ),
  daily_cash as (
    select
      report_dates.report_date,
      case
        when reconciliation_by_date.report_date is not null then reconciliation_by_date.cash_counted
        else greatest(
          (
            coalesce(audit_by_date.scratch_sales, 0) +
            coalesce(terminal_by_date.draw_sales, 0) -
            coalesce(terminal_by_date.ticket_cancels, 0)
          ) -
          (
            coalesce(terminal_by_date.draw_payouts, 0) +
            coalesce(terminal_by_date.scratch_payouts, 0) +
            coalesce(terminal_by_date.promo_credits, 0)
          ),
          0
        )
      end as cash_amount
    from report_dates
    left join audit_by_date using (report_date)
    left join terminal_by_date using (report_date)
    left join reconciliation_by_date using (report_date)
  ),
  paid_statuses as (
    select
      week_start_date,
      week_end_date,
      sweep_date
    from public.lottery_eft_weekly_status
    where store_key = p_store_key
      and status = 'paid'
      and sweep_date <= p_latest_sweep_date
  ),
  paid_eft_by_week as (
    select
      paid_statuses.sweep_date,
      round(
        coalesce(
          sum(
            (
              coalesce(terminal_by_date.draw_sales, 0) -
              coalesce(terminal_by_date.ticket_cancels, 0)
            ) -
            (
              (
                coalesce(terminal_by_date.draw_sales, 0) -
                coalesce(terminal_by_date.ticket_cancels, 0)
              ) * normalized_rates.retailer_rate
            ) -
            (
              (
                coalesce(terminal_by_date.draw_payouts, 0) +
                coalesce(terminal_by_date.scratch_payouts, 0)
              ) * normalized_rates.payout_rate
            ) -
            (
              coalesce(terminal_by_date.draw_payouts, 0) +
              coalesce(terminal_by_date.scratch_payouts, 0)
            ) -
            coalesce(terminal_by_date.promo_credits, 0) +
            coalesce(terminal_by_date.bonding_fee, 0)
          ),
          0
        )::numeric,
        2
      ) as net_eft_due
    from paid_statuses
    cross join normalized_rates
    left join terminal_by_date
      on terminal_by_date.report_date between paid_statuses.week_start_date and paid_statuses.week_end_date
    group by paid_statuses.sweep_date
  ),
  cash_totals as (
    select
      round(coalesce(sum(cash_amount), 0)::numeric, 2) as cash_available_before_paid_eft,
      count(*)::integer as recorded_days
    from daily_cash
  ),
  eft_totals as (
    select
      round(coalesce(sum(net_eft_due), 0)::numeric, 2) as paid_eft_total,
      count(*)::integer as paid_eft_weeks
    from paid_eft_by_week
  )
  select
    round(
      (
        cash_totals.cash_available_before_paid_eft -
        eft_totals.paid_eft_total
      )::numeric,
      2
    ) as cash_after_eft,
    cash_totals.cash_available_before_paid_eft,
    eft_totals.paid_eft_total,
    eft_totals.paid_eft_weeks,
    cash_totals.recorded_days
  from cash_totals
  cross join eft_totals;
$$;

revoke execute on function public.get_lottery_cash_in_hand_summary(
  text,
  date,
  date,
  numeric,
  numeric
) from public;

grant execute on function public.get_lottery_cash_in_hand_summary(
  text,
  date,
  date,
  numeric,
  numeric
) to authenticated;
-- END 202605200001_lottery_cash_in_hand_excludes_float.sql

-- BEGIN 202605200002_daily_sales_variance_cash_vault.sql
alter table public.cash_vault_transactions
  drop constraint if exists cash_vault_transactions_movement_type_check;

alter table public.cash_vault_transactions
  add constraint cash_vault_transactions_movement_type_check
  check (
    movement_type in (
      'cash_sale',
      'sales_payout',
      'cash_variance',
      'cash_expense',
      'vendor_payment_cash',
      'payroll_cash',
      'bank_deposit'
    )
  );

alter table public.inventory_movements
  add column if not exists vendor_invoice_id uuid references public.vendor_invoices (id) on delete set null;

create index if not exists inventory_movements_store_invoice_created_idx
  on public.inventory_movements (store_key, vendor_invoice_id, created_at desc);

create or replace function public.sync_cash_vault_from_sales_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  variance_amount numeric;
  movement_recorded_at timestamptz;
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'daily_sales_reconciliations',
      old.id,
      'sales_payout'
    );
    perform public.delete_cash_vault_transaction(
      'daily_sales_reconciliations',
      old.id,
      'cash_variance'
    );
    return old;
  end if;

  movement_recorded_at := coalesce(
    new.reconciled_at,
    new.updated_at,
    new.created_at,
    timezone('utc', now())
  );

  if new.status = 'approved' and coalesce(new.total_payouts, 0) > 0 then
    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'daily_sales_reconciliations',
      new.id,
      'sales_payout',
      new.reconciliation_date,
      new.total_payouts * -1,
      coalesce(
        nullif(btrim(new.notes), ''),
        'Sales payout recorded during closeout'
      ),
      movement_recorded_at,
      jsonb_build_object(
        'status', new.status,
        'totalPayouts', new.total_payouts,
        'variance', new.variance
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'daily_sales_reconciliations',
      new.id,
      'sales_payout'
    );
  end if;

  variance_amount := round(coalesce(new.variance, 0)::numeric, 2);

  if new.status = 'approved' and variance_amount <> 0 then
    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'daily_sales_reconciliations',
      new.id,
      'cash_variance',
      new.reconciliation_date,
      variance_amount * -1,
      case
        when variance_amount > 0 then 'Daily sales cash shortage'
        else 'Daily sales cash overage'
      end,
      movement_recorded_at,
      jsonb_build_object(
        'status', new.status,
        'variance', new.variance,
        'totalExpected', new.total_expected,
        'totalActual', new.total_actual,
        'cashCounted', new.cash_counted,
        'openingFloat', new.opening_float,
        'closingFloat', new.closing_float
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'daily_sales_reconciliations',
      new.id,
      'cash_variance'
    );
  end if;

  return new;
end;
$$;

delete from public.cash_vault_transactions as vault_transaction
where vault_transaction.source_table = 'daily_sales_reconciliations'
  and vault_transaction.movement_type = 'cash_variance'
  and exists (
    select 1
    from public.daily_sales_reconciliations as reconciliation
    where reconciliation.id = vault_transaction.source_id
      and (
        reconciliation.status <> 'approved'
        or round(coalesce(reconciliation.variance, 0)::numeric, 2) = 0
      )
  );

insert into public.cash_vault_transactions (
  store_key,
  source_table,
  source_id,
  movement_type,
  business_date,
  amount,
  details,
  metadata,
  recorded_at
)
select
  reconciliation.store_key,
  'daily_sales_reconciliations',
  reconciliation.id,
  'cash_variance',
  reconciliation.reconciliation_date,
  round((reconciliation.variance * -1)::numeric, 2),
  case
    when reconciliation.variance > 0 then 'Daily sales cash shortage'
    else 'Daily sales cash overage'
  end,
  jsonb_build_object(
    'status', reconciliation.status,
    'variance', reconciliation.variance,
    'totalExpected', reconciliation.total_expected,
    'totalActual', reconciliation.total_actual,
    'cashCounted', reconciliation.cash_counted,
    'openingFloat', reconciliation.opening_float,
    'closingFloat', reconciliation.closing_float
  ),
  coalesce(
    reconciliation.reconciled_at,
    reconciliation.updated_at,
    reconciliation.created_at,
    timezone('utc', now())
  )
from public.daily_sales_reconciliations as reconciliation
where reconciliation.status = 'approved'
  and round(coalesce(reconciliation.variance, 0)::numeric, 2) <> 0
on conflict (source_table, source_id, movement_type)
do update set
  store_key = excluded.store_key,
  business_date = excluded.business_date,
  amount = excluded.amount,
  details = excluded.details,
  metadata = excluded.metadata,
  recorded_at = excluded.recorded_at,
  updated_at = timezone('utc', now());
-- END 202605200002_daily_sales_variance_cash_vault.sql

-- BEGIN 202605200003_lottery_eft_paid_amount.sql
alter table public.lottery_eft_weekly_status
  add column if not exists paid_amount numeric(12, 2);

alter table public.lottery_eft_weekly_status
  drop constraint if exists lottery_eft_weekly_status_paid_amount_check;

alter table public.lottery_eft_weekly_status
  add constraint lottery_eft_weekly_status_paid_amount_check
  check (
    (status = 'unpaid' and paid_amount is null)
    or (status = 'paid' and (paid_amount is null or paid_amount >= 0))
  );

create or replace function public.get_lottery_cash_in_hand_summary(
  p_store_key text,
  p_end_date date,
  p_latest_sweep_date date,
  p_retailer_commission_rate numeric default 0,
  p_payout_commission_rate numeric default 0
)
returns table (
  cash_after_eft numeric,
  cash_available_before_paid_eft numeric,
  paid_eft_total numeric,
  paid_eft_weeks integer,
  recorded_days integer
)
language sql
stable
as $$
  with normalized_rates as (
    select
      least(greatest(coalesce(p_retailer_commission_rate, 0), 0), 100) / 100 as retailer_rate,
      least(greatest(coalesce(p_payout_commission_rate, 0), 0), 100) / 100 as payout_rate
  ),
  report_dates as (
    select audit_date as report_date
    from public.daily_audits
    where store_key = p_store_key
      and audit_date <= p_end_date
    union
    select report_date
    from public.terminal_reports
    where store_key = p_store_key
      and report_date <= p_end_date
    union
    select report_date
    from public.eod_reconciliation
    where store_key = p_store_key
      and report_date <= p_end_date
  ),
  audit_by_date as (
    select
      audit_date as report_date,
      round(sum(coalesce(calculated_revenue, 0))::numeric, 2) as scratch_sales
    from public.daily_audits
    where store_key = p_store_key
      and audit_date <= p_end_date
    group by audit_date
  ),
  terminal_by_date as (
    select
      report_date,
      round(coalesce(draw_sales, 0)::numeric, 2) as draw_sales,
      round(coalesce(draw_payouts, 0)::numeric, 2) as draw_payouts,
      round(coalesce(scratch_payouts, 0)::numeric, 2) as scratch_payouts,
      round(coalesce(total_cashing_bonus, 0)::numeric, 2) as promo_credits,
      round(coalesce(total_cancels, 0)::numeric, 2) as ticket_cancels,
      round(coalesce(lottery_bonding_fee, 0)::numeric, 2) as bonding_fee
    from public.terminal_reports
    where store_key = p_store_key
      and report_date <= p_end_date
  ),
  reconciliation_by_date as (
    select
      report_date,
      round(
        greatest(
          coalesce(pos_register_total, 0)::numeric -
          coalesce(opening_cash_float, 0)::numeric,
          0
        ),
        2
      ) as cash_counted
    from public.eod_reconciliation
    where store_key = p_store_key
      and report_date <= p_end_date
  ),
  daily_cash as (
    select
      report_dates.report_date,
      case
        when reconciliation_by_date.report_date is not null then reconciliation_by_date.cash_counted
        else greatest(
          (
            coalesce(audit_by_date.scratch_sales, 0) +
            coalesce(terminal_by_date.draw_sales, 0) -
            coalesce(terminal_by_date.ticket_cancels, 0)
          ) -
          (
            coalesce(terminal_by_date.draw_payouts, 0) +
            coalesce(terminal_by_date.scratch_payouts, 0) +
            coalesce(terminal_by_date.promo_credits, 0)
          ),
          0
        )
      end as cash_amount
    from report_dates
    left join audit_by_date using (report_date)
    left join terminal_by_date using (report_date)
    left join reconciliation_by_date using (report_date)
  ),
  paid_statuses as (
    select
      week_start_date,
      week_end_date,
      sweep_date,
      paid_amount
    from public.lottery_eft_weekly_status
    where store_key = p_store_key
      and status = 'paid'
      and sweep_date <= p_latest_sweep_date
  ),
  paid_eft_by_week as (
    select
      paid_statuses.sweep_date,
      coalesce(
        round(paid_statuses.paid_amount::numeric, 2),
        round(
          coalesce(
            sum(
              (
                coalesce(terminal_by_date.draw_sales, 0) -
                coalesce(terminal_by_date.ticket_cancels, 0)
              ) -
              (
                (
                  coalesce(terminal_by_date.draw_sales, 0) -
                  coalesce(terminal_by_date.ticket_cancels, 0)
                ) * normalized_rates.retailer_rate
              ) -
              (
                (
                  coalesce(terminal_by_date.draw_payouts, 0) +
                  coalesce(terminal_by_date.scratch_payouts, 0)
                ) * normalized_rates.payout_rate
              ) -
              (
                coalesce(terminal_by_date.draw_payouts, 0) +
                coalesce(terminal_by_date.scratch_payouts, 0)
              ) -
              coalesce(terminal_by_date.promo_credits, 0) +
              coalesce(terminal_by_date.bonding_fee, 0)
            ),
            0
          )::numeric,
          2
        )
      ) as applied_eft_paid
    from paid_statuses
    cross join normalized_rates
    left join terminal_by_date
      on terminal_by_date.report_date between paid_statuses.week_start_date and paid_statuses.week_end_date
    group by paid_statuses.sweep_date, paid_statuses.paid_amount
  ),
  cash_totals as (
    select
      round(coalesce(sum(cash_amount), 0)::numeric, 2) as cash_available_before_paid_eft,
      count(*)::integer as recorded_days
    from daily_cash
  ),
  eft_totals as (
    select
      round(coalesce(sum(applied_eft_paid), 0)::numeric, 2) as paid_eft_total,
      count(*)::integer as paid_eft_weeks
    from paid_eft_by_week
  )
  select
    round(
      (
        cash_totals.cash_available_before_paid_eft -
        eft_totals.paid_eft_total
      )::numeric,
      2
    ) as cash_after_eft,
    cash_totals.cash_available_before_paid_eft,
    eft_totals.paid_eft_total,
    eft_totals.paid_eft_weeks,
    cash_totals.recorded_days
  from cash_totals
  cross join eft_totals;
$$;

revoke execute on function public.get_lottery_cash_in_hand_summary(
  text,
  date,
  date,
  numeric,
  numeric
) from public;

grant execute on function public.get_lottery_cash_in_hand_summary(
  text,
  date,
  date,
  numeric,
  numeric
) to authenticated;
-- END 202605200003_lottery_eft_paid_amount.sql

-- BEGIN 202605200004_financial_accountability_controls.sql
-- Migration: Financial accountability controls
-- Description: Add evidence, correction, opening-balance, and inventory adjustment controls.

alter table public.lottery_eft_weekly_status
  add column if not exists paid_reference text,
  add column if not exists paid_notes text;

alter table public.bank_deposits
  add column if not exists status text not null default 'posted',
  add column if not exists voided_by uuid references public.profiles (id) on delete set null,
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;

alter table public.bank_deposits
  drop constraint if exists bank_deposits_status_check;

alter table public.bank_deposits
  add constraint bank_deposits_status_check
  check (status in ('posted', 'void'));

update public.bank_deposits
set status = 'posted'
where status is null;

create index if not exists bank_deposits_store_status_date_idx
  on public.bank_deposits (store_key, status, deposit_date desc);

alter table public.cash_vault_transactions
  drop constraint if exists cash_vault_transactions_movement_type_check;

alter table public.cash_vault_transactions
  add constraint cash_vault_transactions_movement_type_check
  check (
    movement_type in (
      'cash_sale',
      'sales_payout',
      'cash_variance',
      'cash_expense',
      'vendor_payment_cash',
      'payroll_cash',
      'bank_deposit',
      'opening_balance',
      'manual_adjustment'
    )
  );

create table if not exists public.cash_vault_adjustments (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  adjustment_date date not null default current_date,
  adjustment_type text not null
    check (adjustment_type in ('opening_balance', 'manual_adjustment')),
  amount numeric(12, 2) not null check (amount <> 0),
  reason text not null check (length(btrim(reason)) > 0),
  reference_number text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists cash_vault_adjustments_store_date_idx
  on public.cash_vault_adjustments (store_key, adjustment_date desc, created_at desc);

alter table public.cash_vault_adjustments enable row level security;

drop policy if exists "cash_vault_adjustments_select_management" on public.cash_vault_adjustments;
create policy "cash_vault_adjustments_select_management"
on public.cash_vault_adjustments
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop policy if exists "cash_vault_adjustments_manage_management" on public.cash_vault_adjustments;
create policy "cash_vault_adjustments_manage_management"
on public.cash_vault_adjustments
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

drop trigger if exists cash_vault_adjustments_set_updated_at on public.cash_vault_adjustments;
create trigger cash_vault_adjustments_set_updated_at
before update on public.cash_vault_adjustments
for each row
execute function public.set_updated_at();

drop trigger if exists cash_vault_adjustments_accounting_period_lock on public.cash_vault_adjustments;
create trigger cash_vault_adjustments_accounting_period_lock
before insert or update or delete on public.cash_vault_adjustments
for each row execute function public.prevent_closed_accounting_period_changes('adjustment_date');

create or replace function public.sync_cash_vault_from_bank_deposit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'bank_deposits',
      old.id,
      'bank_deposit'
    );
    return old;
  end if;

  if coalesce(new.status, 'posted') = 'posted' and coalesce(new.amount, 0) > 0 then
    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'bank_deposits',
      new.id,
      'bank_deposit',
      new.deposit_date,
      new.amount * -1,
      coalesce(nullif(btrim(new.notes), ''), 'Deposit posted to bank'),
      coalesce(new.updated_at, new.created_at, timezone('utc', now())),
      jsonb_build_object(
        'createdBy', new.created_by,
        'slipPhotoUrl', new.slip_photo_url,
        'status', new.status
      )
    );
  else
    perform public.delete_cash_vault_transaction(
      'bank_deposits',
      new.id,
      'bank_deposit'
    );
  end if;

  return new;
end;
$$;

create or replace function public.sync_cash_vault_from_cash_vault_adjustment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  movement_type text;
  detail_text text;
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'cash_vault_adjustments',
      old.id,
      case
        when old.adjustment_type = 'opening_balance' then 'opening_balance'
        else 'manual_adjustment'
      end
    );
    return old;
  end if;

  if tg_op = 'UPDATE' and old.adjustment_type <> new.adjustment_type then
    perform public.delete_cash_vault_transaction(
      'cash_vault_adjustments',
      old.id,
      case
        when old.adjustment_type = 'opening_balance' then 'opening_balance'
        else 'manual_adjustment'
      end
    );
  end if;

  movement_type := case
    when new.adjustment_type = 'opening_balance' then 'opening_balance'
    else 'manual_adjustment'
  end;
  detail_text := concat(
    case
      when new.adjustment_type = 'opening_balance' then 'Opening cash balance'
      else 'Cash vault adjustment'
    end,
    ': ',
    btrim(new.reason)
  );

  if nullif(btrim(coalesce(new.reference_number, '')), '') is not null then
    detail_text := concat(detail_text, ' (Ref ', btrim(new.reference_number), ')');
  end if;

  perform public.upsert_cash_vault_transaction(
    new.store_key,
    'cash_vault_adjustments',
    new.id,
    movement_type,
    new.adjustment_date,
    new.amount,
    detail_text,
    coalesce(new.updated_at, new.created_at, timezone('utc', now())),
    jsonb_build_object(
      'adjustmentType', new.adjustment_type,
      'createdBy', new.created_by,
      'reason', new.reason,
      'referenceNumber', new.reference_number
    )
  );

  return new;
end;
$$;

drop trigger if exists bank_deposits_sync_cash_vault on public.bank_deposits;
create trigger bank_deposits_sync_cash_vault
after insert or update or delete on public.bank_deposits
for each row
execute function public.sync_cash_vault_from_bank_deposit();

drop trigger if exists cash_vault_adjustments_sync_cash_vault on public.cash_vault_adjustments;
create trigger cash_vault_adjustments_sync_cash_vault
after insert or update or delete on public.cash_vault_adjustments
for each row
execute function public.sync_cash_vault_from_cash_vault_adjustment();

alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check
  check (
    movement_type in (
      'vendor_return',
      'vendor_return_reversal',
      'manual_adjustment',
      'vendor_invoice_receipt'
    )
  );

-- END 202605200004_financial_accountability_controls.sql
