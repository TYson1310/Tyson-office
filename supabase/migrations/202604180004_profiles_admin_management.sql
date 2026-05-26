create policy "profiles_update_admin_or_manager"
on public.profiles
for update
to authenticated
using ((select public.is_current_user_role(array['admin', 'manager'])))
with check ((select public.is_current_user_role(array['admin', 'manager'])));
