-- Migration: secure expense documents and normalize categories
-- Description: make expense bill copies private and backfill category labels into canonical reporting buckets.

insert into storage.buckets (id, name, public)
values ('expense-documents', 'expense-documents', false)
on conflict (id) do update
set public = excluded.public;

update public.expense_records
set attachment_url = null
where attachment_url is not null;

update public.expense_records
set category = case
  when btrim(category) = '' then 'Other'
  when lower(btrim(category)) ~ '^(utilities|utility|utility bill|electric|electricity|power|water|sewer|trash|garbage|waste|internet|phone|telecom|gas)$'
    then 'Utilities'
  when lower(btrim(category)) ~ '^(rent|lease)$'
    then 'Rent'
  when lower(regexp_replace(btrim(category), '[^a-z0-9]+', ' ', 'gi')) ~ '^(repairs|repair|maintenance|repairs maintenance|repairs and maintenance)$'
    then 'Repairs & Maintenance'
  when lower(btrim(category)) ~ '^(supplies|supply)$'
    then 'Supplies'
  when lower(btrim(category)) = 'fuel'
    then 'Fuel'
  when lower(btrim(category)) = 'insurance'
    then 'Insurance'
  when lower(regexp_replace(btrim(category), '[^a-z0-9]+', ' ', 'gi')) ~ '^(tax|taxes|license|licenses|permit|permits)$'
    then 'Taxes & Licenses'
  when lower(btrim(category)) ~ '^(cleaning|janitorial)$'
    then 'Cleaning'
  when lower(regexp_replace(btrim(category), '[^a-z0-9]+', ' ', 'gi')) ~ '^(contract labor|contractor labor|labor|contractors)$'
    then 'Contract Labor'
  when lower(btrim(category)) = 'other'
    then 'Other'
  else initcap(regexp_replace(btrim(category), '\s+', ' ', 'g'))
end
where category is not null;
