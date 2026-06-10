-- Rollback for 20260610153000_add_location_timezones.sql
alter table public.locations
  drop column if exists timezone;
