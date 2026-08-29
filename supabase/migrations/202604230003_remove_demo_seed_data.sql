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
