-- Rollback for 20260611220000_add_roastery_ledger_functions.sql
drop function if exists public.recalculate_roastery_snapshots(text, date, text[], text, text, text);
drop function if exists public.roastery_ledger_quantities(text, date);
drop function if exists public.backfill_roastery_opening_balances(text, date);
drop function if exists public.record_roastery_movement(text, text, text, numeric, date, numeric, numeric, text, text, text, text, text, text);

notify pgrst, 'reload schema';
