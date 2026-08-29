-- Migration: secure deposit slip storage
-- Description: Deposit slips are financial documents and should not be served from a public bucket.

update storage.buckets
set public = false
where id = 'deposit-slips';

drop policy if exists "deposit_slips_select_management" on storage.objects;
create policy "deposit_slips_select_management"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'deposit-slips'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);

drop policy if exists "deposit_slips_insert_management" on storage.objects;
create policy "deposit_slips_insert_management"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'deposit-slips'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);
