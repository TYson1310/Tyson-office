-- Migration: scratch-off ticket tracking
-- Description: extends lottery operations with pack bins, manual receiving metadata,
-- shift audit snapshots, and daily POS reconciliation reports.

alter table public.lottery_games
  add column if not exists tickets_per_pack integer not null default 100;

alter table public.lottery_games
  drop constraint if exists lottery_games_tickets_per_pack_check;

alter table public.lottery_games
  add constraint lottery_games_tickets_per_pack_check
  check (tickets_per_pack > 0);

alter table public.lottery_packs
  add column if not exists bin_number integer;

alter table public.lottery_packs
  drop constraint if exists lottery_packs_bin_number_check;

alter table public.lottery_packs
  add constraint lottery_packs_bin_number_check
  check (bin_number is null or (bin_number >= 1 and bin_number <= 40));

create index if not exists lottery_packs_store_status_bin_idx
  on public.lottery_packs (store_key, status, bin_number)
  where bin_number is not null;

create unique index if not exists lottery_packs_store_pack_number_unique_idx
  on public.lottery_packs (store_key, pack_number);

create unique index if not exists lottery_packs_one_active_pack_per_bin_idx
  on public.lottery_packs (store_key, bin_number)
  where status = 'active' and bin_number is not null;

create or replace function public.receive_lottery_scratch_pack(
  p_store_key text,
  p_game_number text,
  p_pack_number text,
  p_ticket_number integer,
  p_employee_id uuid
) returns table (pack_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game record;
  v_existing_pack_id uuid;
  v_existing_pack_game_id uuid;
  v_pack_id uuid;
  v_tickets_per_pack integer;
  v_actor_name text;
  v_actor_role text;
begin
  if p_employee_id is distinct from (select auth.uid()) then
    raise exception 'Employee id must match the authenticated user';
  end if;

  if not (select public.can_access_store(p_store_key, array['admin', 'manager', 'cashier', 'employee'])) then
    raise exception 'Forbidden';
  end if;

  if p_ticket_number is null or p_ticket_number < 0 then
    raise exception 'Ticket number must be a non-negative integer';
  end if;

  select id, tickets_per_pack
  into v_game
  from public.lottery_games
  where store_key = p_store_key
    and game_code = p_game_number
    and game_type = 'scratch'
    and requires_pack_tracking = true
  limit 1;

  if not found then
    raise exception 'Game number % is not configured for scratch-off tracking', p_game_number;
  end if;

  v_tickets_per_pack := greatest(1, coalesce(v_game.tickets_per_pack, 100));

  select full_name, role::text
  into v_actor_name, v_actor_role
  from public.profiles
  where id = p_employee_id;

  select id, lottery_game_id
  into v_existing_pack_id, v_existing_pack_game_id
  from public.lottery_packs
  where store_key = p_store_key
    and pack_number = p_pack_number
  limit 1;

  if v_existing_pack_id is not null then
    if v_existing_pack_game_id <> v_game.id then
      raise exception 'Pack number % is already assigned to another game', p_pack_number;
    end if;

    pack_id := v_existing_pack_id;
    was_created := false;
    return next;
    return;
  end if;

  insert into public.lottery_packs (
    store_key,
    lottery_game_id,
    pack_number,
    start_ticket_number,
    end_ticket_number,
    ticket_count,
    status,
    received_date,
    received_by,
    notes
  )
  values (
    p_store_key,
    v_game.id,
    p_pack_number,
    0,
    v_tickets_per_pack - 1,
    v_tickets_per_pack,
    'received',
    current_date,
    p_employee_id,
    concat('Received from barcode ticket ', lpad(p_ticket_number::text, 3, '0'))
  )
  returning id into v_pack_id;

  pack_id := v_pack_id;
  was_created := true;

  insert into public.audit_events (
    store_key,
    entity_type,
    entity_id,
    action,
    summary,
    actor_id,
    actor_name,
    actor_role,
    metadata
  )
  values (
    p_store_key,
    'lottery_pack',
    v_pack_id::text,
    'lottery.pack_received',
    concat('Scratch pack received: ', p_pack_number),
    p_employee_id,
    v_actor_name,
    coalesce(v_actor_role, 'employee'),
    jsonb_build_object(
      'gameNumber', p_game_number,
      'packNumber', p_pack_number,
      'ticketNumber', p_ticket_number,
      'ticketsPerPack', v_tickets_per_pack
    )
  );

  return next;
end;
$$;

grant execute on function public.receive_lottery_scratch_pack(text, text, text, integer, uuid)
  to authenticated;

create or replace function public.load_lottery_scratch_bin(
  p_store_key text,
  p_pack_id uuid,
  p_bin_number integer,
  p_employee_id uuid
) returns table (active_pack_id uuid, retired_pack_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pack record;
  v_retired_pack_id uuid;
  v_actor_name text;
  v_actor_role text;
begin
  if p_employee_id is distinct from (select auth.uid()) then
    raise exception 'Employee id must match the authenticated user';
  end if;

  if not (select public.can_access_store(p_store_key, array['admin', 'manager', 'cashier', 'employee'])) then
    raise exception 'Forbidden';
  end if;

  if p_bin_number is null or p_bin_number < 1 or p_bin_number > 40 then
    raise exception 'Bin number must be between 1 and 40';
  end if;

  select id, status
  into v_pack
  from public.lottery_packs
  where id = p_pack_id
    and store_key = p_store_key
  for update;

  if not found then
    raise exception 'Lottery pack not found';
  end if;

  if v_pack.status <> 'received' then
    raise exception 'Pack must be received before it can be loaded into a bin';
  end if;

  select full_name, role::text
  into v_actor_name, v_actor_role
  from public.profiles
  where id = p_employee_id;

  select id
  into v_retired_pack_id
  from public.lottery_packs
  where store_key = p_store_key
    and bin_number = p_bin_number
    and status = 'active'
    and id <> p_pack_id
  limit 1
  for update;

  if v_retired_pack_id is not null then
    update public.lottery_packs
    set status = 'settled',
        closed_at = coalesce(closed_at, timezone('utc', now())),
        closed_by = coalesce(closed_by, p_employee_id),
        settled_at = timezone('utc', now()),
        settled_by = p_employee_id,
        updated_at = timezone('utc', now())
    where id = v_retired_pack_id;

    insert into public.audit_events (
      store_key,
      entity_type,
      entity_id,
      action,
      summary,
      actor_id,
      actor_name,
      actor_role,
      metadata
    )
    values (
      p_store_key,
      'lottery_pack',
      v_retired_pack_id::text,
      'lottery.pack_retired_from_bin',
      concat('Scratch bin ', p_bin_number, ' previous pack retired'),
      p_employee_id,
      v_actor_name,
      coalesce(v_actor_role, 'employee'),
      jsonb_build_object(
        'binNumber', p_bin_number,
        'retiredPackId', v_retired_pack_id
      )
    );
  end if;

  update public.lottery_packs
  set status = 'active',
      bin_number = p_bin_number,
      activated_at = timezone('utc', now()),
      activated_by = p_employee_id,
      updated_at = timezone('utc', now())
  where id = p_pack_id;

  active_pack_id := p_pack_id;
  retired_pack_id := v_retired_pack_id;

  insert into public.audit_events (
    store_key,
    entity_type,
    entity_id,
    action,
    summary,
    actor_id,
    actor_name,
    actor_role,
    metadata
  )
  values (
    p_store_key,
    'lottery_pack',
    p_pack_id::text,
    'lottery.pack_loaded_to_bin',
    concat('Scratch pack loaded to bin ', p_bin_number),
    p_employee_id,
    v_actor_name,
    coalesce(v_actor_role, 'employee'),
    jsonb_build_object(
      'binNumber', p_bin_number,
      'retiredPackId', v_retired_pack_id
    )
  );

  return next;
end;
$$;

grant execute on function public.load_lottery_scratch_bin(text, uuid, integer, uuid)
  to authenticated;

create table if not exists public.lottery_bin_audits (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete cascade,
  business_date date not null default current_date,
  lottery_pack_id uuid references public.lottery_packs (id) on delete set null,
  lottery_game_id uuid references public.lottery_games (id) on delete set null,
  audit_kind text not null default 'snapshot'
    check (audit_kind in ('shift_start', 'shift_end', 'snapshot', 'reconciliation')),
  bin_number integer not null check (bin_number >= 1 and bin_number <= 40),
  ticket_number_scanned integer not null check (ticket_number_scanned >= 0),
  start_ticket_number integer check (start_ticket_number is null or start_ticket_number >= 0),
  end_ticket_number integer check (end_ticket_number is null or end_ticket_number >= 0),
  tickets_sold integer not null default 0 check (tickets_sold >= 0),
  calculated_sales numeric(12, 2) not null default 0 check (calculated_sales >= 0),
  pos_sales_amount numeric(12, 2) check (pos_sales_amount is null or pos_sales_amount >= 0),
  short_over numeric(12, 2),
  employee_id uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists lottery_bin_audits_store_date_bin_idx
  on public.lottery_bin_audits (store_key, business_date desc, bin_number asc, recorded_at desc);

create index if not exists lottery_bin_audits_pack_idx
  on public.lottery_bin_audits (lottery_pack_id, recorded_at desc);

create index if not exists lottery_bin_audits_employee_idx
  on public.lottery_bin_audits (store_key, employee_id, recorded_at desc);

alter table public.lottery_bin_audits enable row level security;

drop policy if exists "lottery_bin_audits_select_staff" on public.lottery_bin_audits;
create policy "lottery_bin_audits_select_staff"
on public.lottery_bin_audits
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'cashier', 'employee'])));

drop policy if exists "lottery_bin_audits_insert_staff" on public.lottery_bin_audits;
create policy "lottery_bin_audits_insert_staff"
on public.lottery_bin_audits
for insert
to authenticated
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'cashier', 'employee'])));

drop policy if exists "lottery_bin_audits_manage_management" on public.lottery_bin_audits;
create policy "lottery_bin_audits_manage_management"
on public.lottery_bin_audits
for update
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager'])));

create table if not exists public.lottery_daily_reports (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete cascade,
  business_date date not null,
  expected_sales numeric(12, 2) not null default 0 check (expected_sales >= 0),
  actual_sales numeric(12, 2) not null default 0 check (actual_sales >= 0),
  discrepancy numeric(12, 2) not null default 0,
  recorded_by uuid references public.profiles (id) on delete set null,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lottery_daily_reports_store_date_unique unique (store_key, business_date)
);

drop trigger if exists lottery_daily_reports_set_updated_at on public.lottery_daily_reports;
create trigger lottery_daily_reports_set_updated_at
before update on public.lottery_daily_reports
for each row
execute function public.set_updated_at();

create index if not exists lottery_daily_reports_store_date_idx
  on public.lottery_daily_reports (store_key, business_date desc);

alter table public.lottery_daily_reports enable row level security;

drop policy if exists "lottery_daily_reports_select_staff" on public.lottery_daily_reports;
create policy "lottery_daily_reports_select_staff"
on public.lottery_daily_reports
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'cashier', 'employee'])));

drop policy if exists "lottery_daily_reports_insert_staff" on public.lottery_daily_reports;
create policy "lottery_daily_reports_insert_staff"
on public.lottery_daily_reports
for insert
to authenticated
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'cashier', 'employee'])));

drop policy if exists "lottery_daily_reports_update_staff" on public.lottery_daily_reports;
create policy "lottery_daily_reports_update_staff"
on public.lottery_daily_reports
for update
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'cashier', 'employee'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'cashier', 'employee'])));
