-- Migration: security and financial hardening
-- Description: keep vendor financial documents private, persist private-admin rate limits, and audit private-admin actions.

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
