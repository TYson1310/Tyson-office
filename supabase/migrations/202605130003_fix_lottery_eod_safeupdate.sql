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

  function_definition := replace(
    function_definition,
    'set end_ticket_no = lpad(end_ticket_no::integer::text, 3, ''0'');',
    'set end_ticket_no = lpad(end_ticket_no::integer::text, 3, ''0'')
  where end_ticket_no is not null;'
  );

  execute function_definition;
end
$$;
