-- Rollback for 20260611180000_add_no_order_match_status.sql
-- Reverts the match_status check constraint to exclude 'no_order'.
-- Any rows currently set to 'no_order' must be changed first or the
-- constraint will fail to validate.

update public.inventory_invoices set match_status = 'unmatched'
where match_status = 'no_order';

alter table public.inventory_invoices
  drop constraint if exists inventory_invoices_match_status_check;

alter table public.inventory_invoices
  add constraint inventory_invoices_match_status_check
  check (match_status in ('unmatched', 'auto_matched', 'manually_matched'));

notify pgrst, 'reload schema';
