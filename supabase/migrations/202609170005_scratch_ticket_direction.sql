alter table public.inventory
  add column if not exists ticket_direction text;

update public.inventory
set ticket_direction = 'ascending'
where ticket_direction is null;

alter table public.inventory
  alter column ticket_direction set default 'ascending';

alter table public.inventory
  drop constraint if exists inventory_ticket_direction_check;

alter table public.inventory
  add constraint inventory_ticket_direction_check
  check (ticket_direction in ('ascending', 'descending'));
