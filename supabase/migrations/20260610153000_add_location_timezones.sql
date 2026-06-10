-- Per-location IANA timezone (e.g. 'America/Chicago') used to compute
-- end-of-day boundaries for daily inventory snapshots. Null falls back to UTC.
alter table public.locations
  add column if not exists timezone text;
