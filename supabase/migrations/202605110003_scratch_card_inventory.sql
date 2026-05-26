do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'scratch_pack_status'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.scratch_pack_status as enum (
      'in_backstock',
      'active',
      'settled',
      'returned'
    );
  end if;
end $$;

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  pack_number text not null unique,
  game_id text not null references public.game_catalog (game_id) on delete restrict,
  status public.scratch_pack_status not null default 'in_backstock',
  bin_number integer,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_pack_number_not_blank check (length(trim(pack_number)) > 0),
  constraint inventory_bin_number_positive check (bin_number is null or bin_number > 0),
  constraint inventory_backstock_has_no_bin check (
    status <> 'in_backstock'
    or bin_number is null
  ),
  constraint inventory_active_requires_bin check (
    status <> 'active'
    or bin_number is not null
  )
);

create unique index if not exists inventory_active_bin_unique
on public.inventory (store_key, bin_number)
where status = 'active';

create index if not exists inventory_store_status_idx
on public.inventory (store_key, status);

create index if not exists inventory_game_id_idx
on public.inventory (game_id);

drop trigger if exists inventory_set_updated_at on public.inventory;
create trigger inventory_set_updated_at
before update on public.inventory
for each row
execute function public.set_updated_at();

create table if not exists public.audits (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  timestamp timestamptz not null default timezone('utc', now()),
  employee_id uuid not null references public.profiles (id) on delete restrict,
  inventory_id uuid not null references public.inventory (id) on delete restrict,
  bin_number integer not null,
  ticket_number_scanned text not null,
  calculated_sales numeric(12, 2) not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint audits_bin_number_positive check (bin_number > 0),
  constraint audits_ticket_number_not_blank check (length(trim(ticket_number_scanned)) > 0),
  constraint audits_calculated_sales_nonnegative check (calculated_sales >= 0)
);

create index if not exists audits_store_timestamp_idx
on public.audits (store_key, timestamp desc);

create index if not exists audits_employee_id_idx
on public.audits (employee_id);

create index if not exists audits_inventory_id_idx
on public.audits (inventory_id);

drop trigger if exists audits_set_updated_at on public.audits;
create trigger audits_set_updated_at
before update on public.audits
for each row
execute function public.set_updated_at();

create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  report_date date not null,
  expected_sales numeric(12, 2) not null default 0,
  actual_sales numeric(12, 2) not null default 0,
  discrepancy numeric(12, 2) generated always as (actual_sales - expected_sales) stored,
  discrepancy_status text generated always as (
    case
      when actual_sales - expected_sales < 0 then 'short'
      when actual_sales - expected_sales > 0 then 'over'
      else 'balanced'
    end
  ) stored,
  submitted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint daily_reports_sales_nonnegative check (
    expected_sales >= 0
    and actual_sales >= 0
  ),
  constraint daily_reports_store_date_unique unique (store_key, report_date)
);

create index if not exists daily_reports_report_date_idx
on public.daily_reports (report_date desc);

create index if not exists daily_reports_submitted_by_idx
on public.daily_reports (submitted_by);

drop trigger if exists daily_reports_set_updated_at on public.daily_reports;
create trigger daily_reports_set_updated_at
before update on public.daily_reports
for each row
execute function public.set_updated_at();

create or replace function public.recalculate_daily_report_expected_sales(
  target_store_key text,
  target_report_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_total numeric(12, 2);
begin
  if target_store_key is null or target_report_date is null then
    return;
  end if;

  select coalesce(sum(calculated_sales), 0)::numeric(12, 2)
  into expected_total
  from public.audits
  where store_key = target_store_key
    and (timestamp at time zone 'utc')::date = target_report_date;

  insert into public.daily_reports (
    store_key,
    report_date,
    expected_sales
  )
  values (
    target_store_key,
    target_report_date,
    expected_total
  )
  on conflict (store_key, report_date) do update
  set
    expected_sales = excluded.expected_sales,
    updated_at = timezone('utc', now());
end;
$$;

create or replace function public.sync_daily_report_expected_sales()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.recalculate_daily_report_expected_sales(
      old.store_key,
      (old.timestamp at time zone 'utc')::date
    );
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recalculate_daily_report_expected_sales(
      new.store_key,
      (new.timestamp at time zone 'utc')::date
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists audits_sync_daily_report_expected_sales on public.audits;
create trigger audits_sync_daily_report_expected_sales
after insert or update or delete on public.audits
for each row
execute function public.sync_daily_report_expected_sales();

alter table public.inventory enable row level security;
alter table public.audits enable row level security;
alter table public.daily_reports enable row level security;

drop policy if exists "inventory_select_operations" on public.inventory;
create policy "inventory_select_operations"
on public.inventory
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

drop policy if exists "inventory_manage_management" on public.inventory;
create policy "inventory_manage_management"
on public.inventory
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager'])));

drop policy if exists "audits_select_operations" on public.audits;
create policy "audits_select_operations"
on public.audits
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier', 'employee'])));

drop policy if exists "audits_insert_operations" on public.audits;
create policy "audits_insert_operations"
on public.audits
for insert
to authenticated
with check (
  (select public.can_access_store(store_key, array['admin', 'manager', 'cashier', 'employee']))
  and (
    employee_id = (select auth.uid())
    or (select public.is_current_user_role(array['admin', 'manager']))
  )
);

drop policy if exists "audits_manage_management" on public.audits;
create policy "audits_manage_management"
on public.audits
for update
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager'])));

drop policy if exists "audits_delete_management" on public.audits;
create policy "audits_delete_management"
on public.audits
for delete
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager'])));

drop policy if exists "daily_reports_select_operations" on public.daily_reports;
create policy "daily_reports_select_operations"
on public.daily_reports
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant', 'cashier'])));

drop policy if exists "daily_reports_manage_management" on public.daily_reports;
create policy "daily_reports_manage_management"
on public.daily_reports
for all
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));
