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
