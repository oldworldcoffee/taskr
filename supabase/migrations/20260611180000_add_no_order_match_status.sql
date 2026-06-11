-- Allow invoices to be marked as intentionally needing no purchase order
-- (e.g. par-based deliveries like milk/bread). Extends the match_status check
-- constraint added in 20260611150000 to include 'no_order', which the
-- Unmatched Invoices queue uses to dismiss an invoice without linking it.

alter table public.inventory_invoices
  drop constraint if exists inventory_invoices_match_status_check;

alter table public.inventory_invoices
  add constraint inventory_invoices_match_status_check
  check (match_status in ('unmatched', 'auto_matched', 'manually_matched', 'no_order'));

notify pgrst, 'reload schema';
