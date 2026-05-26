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
  exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = any (array['admin', 'manager', 'accountant'])
  )
);

drop policy if exists "audit_events_insert_management" on public.audit_events;
create policy "audit_events_insert_management"
on public.audit_events
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = any (array['admin', 'manager', 'accountant'])
  )
);
