alter table public.daily_audits
  drop constraint if exists daily_audits_audit_type_valid;

alter table public.daily_audits
  add constraint daily_audits_audit_type_valid check (
    audit_type in (
      'opening',
      'shift',
      'eod',
      'bin_load_retirement',
      'active_29_day_settlement',
      'eft_settlement_reversal'
    )
  );
