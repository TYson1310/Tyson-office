alter table public.pos_cash_eod_reviews
  add column if not exists update_count integer not null default 0;
