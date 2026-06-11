-- Rollback for 20260611140000_add_roastery_inventory_snapshots.sql
drop table if exists public.roastery_inventory_snapshots;

notify pgrst, 'reload schema';
