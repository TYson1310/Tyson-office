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
