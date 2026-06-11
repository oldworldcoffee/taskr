-- Rollback for 20260611210000_add_roastery_inventory_ledger.sql
alter table public.roastery_inventory_snapshots
  drop column if exists day_start_lbs_on_hand,
  drop column if exists day_start_lbs_warehoused,
  drop column if exists is_recalculated,
  drop column if exists recalculated_at;
drop table if exists public.roastery_inventory_snapshot_audits;
drop table if exists public.roastery_inventory_movements;

notify pgrst, 'reload schema';
