do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.save_lottery_eod_reconciliation(text,date,jsonb,numeric,numeric,numeric,numeric,numeric,numeric,text,uuid)'::regprocedure
  )
  into function_definition;

  if function_definition is null then
    raise exception 'Lottery EOD reconciliation function is missing';
  end if;

  function_definition := replace(
    function_definition,
    'if end_ticket_value < start_ticket_value then',
    'if false then'
  );
  function_definition := replace(
    function_definition,
    'sold_ticket_count := end_ticket_value - start_ticket_value;',
    'sold_ticket_count := abs(end_ticket_value - start_ticket_value);'
  );

  execute function_definition;
end
$$;
