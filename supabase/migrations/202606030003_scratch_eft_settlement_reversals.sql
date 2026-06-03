alter table public.daily_audits
  drop constraint if exists daily_audits_audit_type_valid;

alter table public.daily_audits
  add constraint daily_audits_audit_type_valid check (
    audit_type in (
      'opening',
      'shift',
      'eod',
      'bin_load_retirement',
      'eft_settlement_reversal'
    )
  );

create index if not exists daily_audits_store_inventory_type_date_idx
on public.daily_audits (
  store_key,
  inventory_id,
  audit_type,
  audit_date desc,
  created_at desc
)
where inventory_id is not null;
