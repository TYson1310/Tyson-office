-- Migration: expense document support
-- Description: allow expense ledger entries to store a bill copy or receipt attachment.

alter table public.expense_records
  add column if not exists attachment_name text,
  add column if not exists attachment_path text,
  add column if not exists attachment_url text,
  add column if not exists attachment_mime_type text;

insert into storage.buckets (id, name, public)
values ('expense-documents', 'expense-documents', false)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "expense_document_storage_select_management" on storage.objects;
create policy "expense_document_storage_select_management"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'expense-documents'
  and (select public.is_current_user_role(array['admin', 'manager']))
);

drop policy if exists "expense_document_storage_insert_management" on storage.objects;
create policy "expense_document_storage_insert_management"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'expense-documents'
  and (select public.is_current_user_role(array['admin', 'manager']))
);

drop policy if exists "expense_document_storage_update_management" on storage.objects;
create policy "expense_document_storage_update_management"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'expense-documents'
  and (select public.is_current_user_role(array['admin', 'manager']))
)
with check (
  bucket_id = 'expense-documents'
  and (select public.is_current_user_role(array['admin', 'manager']))
);

drop policy if exists "expense_document_storage_delete_management" on storage.objects;
create policy "expense_document_storage_delete_management"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'expense-documents'
  and (select public.is_current_user_role(array['admin', 'manager']))
);
