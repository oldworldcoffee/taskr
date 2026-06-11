-- Rollback for 20260611190000_add_inventory_count_date.sql

alter table public.inventory_counts
  drop column if exists count_date;

notify pgrst, 'reload schema';
