create or replace function public.handle_new_store_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.store_settings (store_key)
  values (new.store_key)
  on conflict (store_key) do nothing;

  return new;
end;
$$;

drop trigger if exists stores_create_default_settings on public.stores;
create trigger stores_create_default_settings
after insert on public.stores
for each row
execute function public.handle_new_store_settings();

insert into public.store_settings (store_key)
select s.store_key
from public.stores as s
left join public.store_settings as ss
  on ss.store_key = s.store_key
where ss.store_key is null
on conflict (store_key) do nothing;
