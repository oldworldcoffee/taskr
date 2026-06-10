-- Rolls back 20260611120000_add_roastery_management.sql
-- WARNING: drops all Roastery Management data.

drop table if exists public.roastery_pricing_records;
drop table if exists public.roastery_blend_component_rotations;
drop table if exists public.roastery_category_rotations;
drop table if exists public.roastery_category_slots;
drop table if exists public.roastery_inventory_adjustments;
drop table if exists public.roastery_inventory_lots;
drop table if exists public.roastery_invoices;
drop table if exists public.roastery_warehouse_locations;
drop table if exists public.roastery_green_coffees;
drop table if exists public.roastery_settings;
