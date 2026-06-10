-- Rollback for 20260610170000_add_item_each_conversion.sql
alter table public.inventory_items
  drop column if exists each_conversion;

notify pgrst, 'reload schema';
