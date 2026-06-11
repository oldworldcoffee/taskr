-- Rollback for 20260611160000_add_inventory_ledger_functions.sql
-- Note: this does not remove opening_balance / receipt movements already
-- written to inventory_movements; drop those manually if a full revert is
-- required (e.g. delete from inventory_movements where source_type = 'opening_balance').

drop function if exists public.backfill_inventory_opening_balances(text, date);
drop function if exists public.record_inventory_movement(text, text, text, numeric, numeric, text, date, text, text, text);

notify pgrst, 'reload schema';
