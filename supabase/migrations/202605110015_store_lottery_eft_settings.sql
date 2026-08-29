alter table public.store_settings
  add column if not exists lottery_retailer_commission_rate numeric(5, 2) not null default 0,
  add column if not exists lottery_cashing_bonus_rate numeric(5, 2) not null default 0;

alter table public.store_settings
  drop constraint if exists store_settings_lottery_retailer_commission_rate_check,
  drop constraint if exists store_settings_lottery_cashing_bonus_rate_check;

alter table public.store_settings
  add constraint store_settings_lottery_retailer_commission_rate_check
  check (lottery_retailer_commission_rate >= 0 and lottery_retailer_commission_rate <= 100),
  add constraint store_settings_lottery_cashing_bonus_rate_check
  check (lottery_cashing_bonus_rate >= 0 and lottery_cashing_bonus_rate <= 100);
