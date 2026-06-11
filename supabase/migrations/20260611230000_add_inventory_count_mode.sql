-- Inventory count mode (spec #5): a count is either a Day Start count
-- (inventory before that day's activity — before invoices/transfers received
-- and production) or a Day End count (after all the day's activity). A
-- day_start count on date D reconciles to the end of D-1; a day_end count
-- reconciles to the end of D. Defaults to day_end (the prior behavior).

alter table public.inventory_counts
  add column if not exists count_mode text not null default 'day_end'
    check (count_mode in ('day_start', 'day_end'));

notify pgrst, 'reload schema';
