-- Rollback for 20260611170000_add_snapshot_ledger_functions.sql

drop function if exists public.recalculate_inventory_snapshots(text, text, date, text[], text, text, text, text);
drop function if exists public.inventory_ledger_quantities(text, text, date);

notify pgrst, 'reload schema';
