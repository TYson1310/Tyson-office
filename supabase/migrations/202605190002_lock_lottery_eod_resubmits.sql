do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.save_lottery_eod_reconciliation(text,date,jsonb,numeric,numeric,numeric,numeric,numeric,numeric,text,uuid)'::regprocedure
  )
  into function_definition;

  if function_definition is null then
    raise exception 'save_lottery_eod_reconciliation function is missing';
  end if;

  if function_definition not like '%Lottery EOD reconciliation is already saved for this date%' then
    function_definition := replace(
      function_definition,
      '  perform pg_advisory_xact_lock(
    hashtext(target_store_key),
    target_report_date - date ''2000-01-01''
  );
',
      '  perform pg_advisory_xact_lock(
    hashtext(target_store_key),
    target_report_date - date ''2000-01-01''
  );

  if exists (
    select 1
    from public.eod_reconciliation reconciliation
    where reconciliation.store_key = target_store_key
      and reconciliation.report_date = target_report_date
  )
    and not public.is_current_user_role(array[''admin''])
  then
    raise exception ''Lottery EOD reconciliation is already saved for this date''
      using errcode = ''23505'';
  end if;
'
    );

    if function_definition not like '%Lottery EOD reconciliation is already saved for this date%' then
      raise exception 'Could not patch save_lottery_eod_reconciliation duplicate-submit guard';
    end if;

    execute function_definition;
  end if;
end
$$;
