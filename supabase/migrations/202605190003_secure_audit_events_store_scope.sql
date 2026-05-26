drop policy if exists "audit_events_select_management" on public.audit_events;
create policy "audit_events_select_management"
on public.audit_events
for select
to authenticated
using (
  (select public.can_access_store(store_key, array['admin', 'manager', 'accountant']))
);

drop policy if exists "audit_events_insert_management" on public.audit_events;
create policy "audit_events_insert_management"
on public.audit_events
for insert
to authenticated
with check (
  actor_id = (select auth.uid())
  and (
    select public.can_access_store(
      store_key,
      array['admin', 'manager', 'accountant', 'cashier', 'employee']
    )
  )
);
