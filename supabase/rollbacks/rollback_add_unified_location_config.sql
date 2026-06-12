-- Rollback for 20260612190000_add_unified_location_config.sql.
-- The source tables (inventory_location_settings, financial_labor_settings) were
-- never modified, so dropping the new columns/table fully restores the prior state
-- and the old read paths keep working.

drop table if exists public.location_feature_audit;

drop index if exists public.locations_is_commissary_idx;

alter table public.locations
  drop column if exists is_task_checklist_enabled,
  drop column if exists is_inventory_enabled,
  drop column if exists is_roastery_enabled,
  drop column if exists is_financial_enabled,
  drop column if exists preferred_stock_weeks,
  drop column if exists is_commissary,
  drop column if exists inventory_settings_json,
  drop column if exists financial_settings_json,
  drop column if exists roastery_settings_json,
  drop column if exists primary_manager_user_id,
  drop column if exists secondary_manager_user_id,
  drop column if exists notes;

notify pgrst, 'reload schema';
