create table if not exists public.login_activity (
  id uuid primary key default gen_random_uuid(),
  session_id text unique,
  user_id uuid not null references public.profiles (id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null,
  assigned_store_key text references public.stores (store_key) on delete set null,
  ip_address text,
  user_agent text not null,
  browser_name text,
  browser_version text,
  os_name text,
  os_version text,
  device_type text not null default 'unknown'
    check (device_type in ('desktop', 'mobile', 'tablet', 'bot', 'unknown')),
  device_name text,
  metadata jsonb not null default '{}'::jsonb,
  signed_in_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now())
);

create index if not exists login_activity_signed_in_at_idx
  on public.login_activity (signed_in_at desc);

create index if not exists login_activity_user_id_signed_in_at_idx
  on public.login_activity (user_id, signed_in_at desc);

create index if not exists login_activity_assigned_store_key_signed_in_at_idx
  on public.login_activity (assigned_store_key, signed_in_at desc);

alter table public.login_activity enable row level security;

drop policy if exists "login_activity_select_admin" on public.login_activity;
create policy "login_activity_select_admin"
on public.login_activity
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  )
);
