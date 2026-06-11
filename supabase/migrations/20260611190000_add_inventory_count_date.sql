-- Effective date for an inventory count. A count asserts the actual on-hand
-- as of this date; a past date backdates the reconciliation (delta measured
-- against the ledger as of that date) and recomputes historical snapshots.
-- Defaults to the submission date for existing/legacy counts.

alter table public.inventory_counts
  add column if not exists count_date date;

notify pgrst, 'reload schema';
