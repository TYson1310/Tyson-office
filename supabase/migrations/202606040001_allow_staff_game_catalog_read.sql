drop policy if exists "game_catalog_select_staff" on public.game_catalog;
create policy "game_catalog_select_staff"
on public.game_catalog
for select
to authenticated
using (
  (select public.is_current_user_role(
    array['admin', 'manager', 'accountant', 'cashier', 'employee']
  ))
);

drop policy if exists "game_catalog_prizes_select_staff" on public.game_catalog_prizes;
create policy "game_catalog_prizes_select_staff"
on public.game_catalog_prizes
for select
to authenticated
using (
  (select public.is_current_user_role(
    array['admin', 'manager', 'accountant', 'cashier', 'employee']
  ))
);

drop policy if exists "game_catalog_storage_select_staff" on storage.objects;
create policy "game_catalog_storage_select_staff"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'game-catalog'
  and (select public.is_current_user_role(
    array['admin', 'manager', 'accountant', 'cashier', 'employee']
  ))
);
