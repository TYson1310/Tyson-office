-- Migration: expense review notes
-- Description: store optional approval and void comments for expense review actions.

alter table public.expense_records
  add column if not exists approval_note text,
  add column if not exists void_note text;
