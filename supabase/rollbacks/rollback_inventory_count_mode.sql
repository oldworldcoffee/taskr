-- Rollback for 20260611230000_add_inventory_count_mode.sql
alter table public.inventory_counts
  drop column if exists count_mode;

notify pgrst, 'reload schema';
