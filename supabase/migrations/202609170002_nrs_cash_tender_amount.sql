alter table public.nrs_email_imports
  add column if not exists cash_tender_total numeric(12, 2);
