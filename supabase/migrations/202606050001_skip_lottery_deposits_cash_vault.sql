create or replace function public.sync_cash_vault_from_bank_deposit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.delete_cash_vault_transaction(
      'bank_deposits',
      old.id,
      'bank_deposit'
    );
    return old;
  end if;

  if coalesce(new.cash_source, 'store_till') = 'lottery_till' then
    perform public.delete_cash_vault_transaction(
      'bank_deposits',
      new.id,
      'bank_deposit'
    );
    return new;
  end if;

  if coalesce(new.status, 'posted') = 'posted' and coalesce(new.amount, 0) > 0 then
    perform public.upsert_cash_vault_transaction(
      new.store_key,
      'bank_deposits',
      new.id,
      'bank_deposit',
      new.deposit_date,
      new.amount * -1,
      coalesce(nullif(btrim(new.notes), ''), 'Deposit posted to bank'),
      coalesce(new.updated_at, new.created_at, timezone('utc', now())),
      jsonb_build_object(
        'cashSource', new.cash_source,
        'createdBy', new.created_by,
        'slipPhotoUrl', new.slip_photo_url,
        'status', new.status
      ),
      new.cash_source
    );
  else
    perform public.delete_cash_vault_transaction(
      'bank_deposits',
      new.id,
      'bank_deposit'
    );
  end if;

  return new;
end;
$$;

delete from public.cash_vault_transactions
where source_table = 'bank_deposits'
  and movement_type = 'bank_deposit'
  and (
    cash_source = 'lottery_till'
    or metadata ->> 'cashSource' = 'lottery_till'
  );
