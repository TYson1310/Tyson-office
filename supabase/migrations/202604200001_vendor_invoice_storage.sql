insert into storage.buckets (id, name, public)
values ('vendor-invoices', 'vendor-invoices', true)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "vendor_invoice_storage_select_management" on storage.objects;
create policy "vendor_invoice_storage_select_management"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'vendor-invoices'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);

drop policy if exists "vendor_invoice_storage_insert_management" on storage.objects;
create policy "vendor_invoice_storage_insert_management"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'vendor-invoices'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);

drop policy if exists "vendor_invoice_storage_update_management" on storage.objects;
create policy "vendor_invoice_storage_update_management"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'vendor-invoices'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
)
with check (
  bucket_id = 'vendor-invoices'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);

drop policy if exists "vendor_invoice_storage_delete_management" on storage.objects;
create policy "vendor_invoice_storage_delete_management"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'vendor-invoices'
  and (select public.is_current_user_role(array['admin', 'manager', 'accountant']))
);
