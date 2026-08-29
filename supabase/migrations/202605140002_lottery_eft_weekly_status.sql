create table if not exists public.lottery_eft_weekly_status (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete cascade,
  week_start_date date not null,
  week_end_date date not null,
  sweep_date date not null,
  status text not null default 'unpaid',
  paid_at timestamptz,
  marked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint lottery_eft_weekly_status_status_check
    check (status in ('paid', 'unpaid')),
  constraint lottery_eft_weekly_status_week_check
    check (
      week_end_date = week_start_date + 6
      and sweep_date = week_end_date + 1
      and extract(isodow from week_start_date) = 4
      and extract(isodow from week_end_date) = 3
      and extract(isodow from sweep_date) = 4
    ),
  constraint lottery_eft_weekly_status_paid_at_check
    check (
      (status = 'paid' and paid_at is not null)
      or (status = 'unpaid' and paid_at is null)
    ),
  constraint lottery_eft_weekly_status_store_sweep_unique
    unique (store_key, sweep_date)
);

create index if not exists lottery_eft_weekly_status_store_sweep_idx
  on public.lottery_eft_weekly_status (store_key, sweep_date desc);

drop trigger if exists lottery_eft_weekly_status_set_updated_at
on public.lottery_eft_weekly_status;
create trigger lottery_eft_weekly_status_set_updated_at
before update on public.lottery_eft_weekly_status
for each row
execute function public.set_updated_at();

alter table public.lottery_eft_weekly_status enable row level security;

drop policy if exists "lottery_eft_weekly_status_select_operations"
on public.lottery_eft_weekly_status;
create policy "lottery_eft_weekly_status_select_operations"
on public.lottery_eft_weekly_status
for select
to authenticated
using (
  (
    select public.can_access_store(
      store_key,
      array['admin', 'manager', 'accountant', 'cashier', 'employee']
    )
  )
);

drop policy if exists "lottery_eft_weekly_status_insert_admin"
on public.lottery_eft_weekly_status;
create policy "lottery_eft_weekly_status_insert_admin"
on public.lottery_eft_weekly_status
for insert
to authenticated
with check ((select public.can_access_store(store_key, array['admin'])));

drop policy if exists "lottery_eft_weekly_status_update_admin"
on public.lottery_eft_weekly_status;
create policy "lottery_eft_weekly_status_update_admin"
on public.lottery_eft_weekly_status
for update
to authenticated
using ((select public.can_access_store(store_key, array['admin'])))
with check ((select public.can_access_store(store_key, array['admin'])));
