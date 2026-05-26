-- Migration: Add Cash Vault (Bank Deposits)
-- Description: Create bank_deposits table and storage for deposit slips.

-- Create bank_deposits table
create table if not exists public.bank_deposits (
  id uuid primary key default gen_random_uuid(),
  store_key text not null references public.stores (store_key) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  deposit_date date not null default current_date,
  notes text,
  slip_photo_url text,
  slip_photo_path text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Enable RLS
alter table public.bank_deposits enable row level security;

-- Add updated_at trigger
drop trigger if exists bank_deposits_set_updated_at on public.bank_deposits;
create trigger bank_deposits_set_updated_at
before update on public.bank_deposits
for each row
execute function public.set_updated_at();

-- Add RLS policies
create policy "bank_deposits_select_management"
on public.bank_deposits
for select
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

create policy "bank_deposits_insert_management"
on public.bank_deposits
for insert
to authenticated
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

create policy "bank_deposits_update_management"
on public.bank_deposits
for update
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])))
with check ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

create policy "bank_deposits_delete_management"
on public.bank_deposits
for delete
to authenticated
using ((select public.can_access_store(store_key, array['admin', 'manager', 'accountant'])));

-- Create storage bucket for deposit slips
insert into storage.buckets (id, name, public)
values ('deposit-slips', 'deposit-slips', true)
on conflict (id) do nothing;

-- Add storage policies
create policy "deposit_slips_select_management"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'deposit-slips'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);

create policy "deposit_slips_insert_management"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'deposit-slips'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);

-- Create index for performance
create index if not exists bank_deposits_store_key_deposit_date_idx
  on public.bank_deposits (store_key, deposit_date desc);
