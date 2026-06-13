-- Rolls back 20260616120000_add_catering_events.sql
-- WARNING: drops all Catering Event Management data.

drop table if exists public.catering_packing_list;
drop table if exists public.catering_checklist_items;
drop table if exists public.catering_crew;
drop table if exists public.catering_events;
