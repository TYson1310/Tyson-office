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
