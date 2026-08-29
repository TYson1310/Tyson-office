alter table public.products
  alter column target_margin_percent set default 40;

update public.products
set target_margin_percent = 40
where target_margin_percent = 35;
