-- Rollback for 20260611150000_add_order_receiving_invoice_model.sql

-- Drop column additions FIRST so foreign keys referencing the new tables are
-- removed before those tables are dropped (e.g. inventory_invoices
-- .receiving_event_id -> inventory_receiving_events).
alter table public.users
  drop column if exists feature_permissions;

alter table public.locations
  drop column if exists location_type;

alter table public.inventory_snapshots
  drop column if exists day_start_quantity,
  drop column if exists day_end_quantity,
  drop column if exists day_start_value,
  drop column if exists day_end_value,
  drop column if exists is_recalculated,
  drop column if exists recalculated_at;

alter table public.inventory_invoices
  drop column if exists receiving_event_id,
  drop column if exists received_date,
  drop column if exists entry_date,
  drop column if exists po_number,
  drop column if exists vendor_reference,
  drop column if exists match_status,
  drop column if exists matched_at,
  drop column if exists matched_by;

alter table public.inventory_orders
  drop column if exists po_number,
  drop column if exists vendor_reference,
  drop column if exists ordered_at,
  drop column if exists closed_at,
  drop column if exists closed_by,
  drop column if exists close_reason;

-- New tables (children first). Use cascade as a safety net for any remaining
-- dependent objects.
drop table if exists public.inventory_snapshot_audits cascade;
drop table if exists public.inventory_movements cascade;
drop table if exists public.inventory_receiving_lines cascade;
drop table if exists public.inventory_receiving_events cascade;
drop table if exists public.inventory_order_lines cascade;

notify pgrst, 'reload schema';
