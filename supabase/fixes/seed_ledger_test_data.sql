-- Test data for the order/receiving/invoice/ledger rework (Phases 1-3).
-- Paste into the DEV Supabase SQL editor AFTER applying migrations
-- 20260611150000, 20260611160000, and 20260611170000.
--
-- Seeds a small catalog under the Old World dev company so you can drive the
-- real app flows (Invoices -> Review -> Confirm, Transfers, Counts) and watch
-- the inventory_movements ledger + snapshots populate. All rows use a test_
-- id prefix for easy cleanup (see the CLEANUP block at the bottom).
--
-- No backfill is needed: with no pre-existing stock, the empty ledger already
-- agrees with the (empty) on-hand counters at 0.

-- Old World dev company id (see taskr-environments memory).
-- If your dev company id differs, replace every occurrence below.

-- 1. Location (retail) -------------------------------------------------------
insert into public.locations (id, company_id, name, address, is_active, location_type, timezone)
values ('test_loc_owc', '210fc811-6cb3-4c39-9086-1c194b965ea8', 'Test Cafe (Ledger QA)', '123 Test St', true, 'retail', 'America/Los_Angeles')
on conflict (id) do nothing;

-- 2. Vendor ------------------------------------------------------------------
insert into public.inventory_vendors (id, company_id, name, order_type, email, is_active)
values ('test_vendor_owc', '210fc811-6cb3-4c39-9086-1c194b965ea8', 'Test Roaster Supply', 'email', 'orders@testroaster.example', true)
on conflict (id) do nothing;

-- 3. Catalog items -----------------------------------------------------------
insert into public.inventory_items (id, company_id, name, sku, category, unit_of_measure, unit_cost, is_active)
values
  ('test_item_a', '210fc811-6cb3-4c39-9086-1c194b965ea8', 'Test House Blend', 'TST-HB', 'Coffee', 'lb', 8.50, true),
  ('test_item_b', '210fc811-6cb3-4c39-9086-1c194b965ea8', 'Test Oat Milk',    'TST-OM', 'Dairy',  'each', 3.25, true),
  ('test_item_c', '210fc811-6cb3-4c39-9086-1c194b965ea8', 'Test Cups 12oz',   'TST-CP', 'Supplies','each', 0.12, true)
on conflict (id) do nothing;

-- 4. Order + normalized order lines -----------------------------------------
insert into public.inventory_orders (id, company_id, type, status, location_id, vendor_id, order_number, po_number, items, total_amount, ordered_at)
values (
  'test_order_owc', '210fc811-6cb3-4c39-9086-1c194b965ea8', 'vendor', 'ordered',
  'test_loc_owc', 'test_vendor_owc', 'TEST-PO-1001', 'PO-1001',
  '[{"item_id":"test_item_a","item_name":"Test House Blend","quantity_ordered":20,"quantity_received":0,"unit_of_measure":"lb","unit_cost":8.5},
    {"item_id":"test_item_b","item_name":"Test Oat Milk","quantity_ordered":12,"quantity_received":0,"unit_of_measure":"each","unit_cost":3.25},
    {"item_id":"test_item_c","item_name":"Test Cups 12oz","quantity_ordered":500,"quantity_received":0,"unit_of_measure":"each","unit_cost":0.12}]'::jsonb,
  269.00, now()
)
on conflict (id) do nothing;

insert into public.inventory_order_lines (id, company_id, order_id, item_id, item_name, unit_of_measure, ordered_quantity, received_quantity, unit_cost, status, sort_order)
values
  ('test_ol_a', '210fc811-6cb3-4c39-9086-1c194b965ea8', 'test_order_owc', 'test_item_a', 'Test House Blend', 'lb',   20, 0, 8.50, 'pending', 0),
  ('test_ol_b', '210fc811-6cb3-4c39-9086-1c194b965ea8', 'test_order_owc', 'test_item_b', 'Test Oat Milk',    'each', 12, 0, 3.25, 'pending', 1),
  ('test_ol_c', '210fc811-6cb3-4c39-9086-1c194b965ea8', 'test_order_owc', 'test_item_c', 'Test Cups 12oz',   'each', 500, 0, 0.12, 'pending', 2)
on conflict (id) do nothing;

-- 5. Invoice (pending_review, matched to the items) --------------------------
-- Shows up in the app under Invoices with a "Review" button. In the review
-- dialog you can set the Received Date (try a past date to exercise backdated
-- recalculation) and Confirm.
insert into public.inventory_invoices (id, company_id, order_id, location_id, vendor_name, invoice_number, invoice_date, status, extracted_items, total_amount, match_status)
values (
  'test_inv_owc', '210fc811-6cb3-4c39-9086-1c194b965ea8', 'test_order_owc', 'test_loc_owc',
  'Test Roaster Supply', 'TEST-INV-2001', current_date, 'pending_review',
  '[{"item_id":"test_item_a","item_name":"Test House Blend","quantity":20,"unit_cost":8.5,"unit_of_measure":"lb"},
    {"item_id":"test_item_b","item_name":"Test Oat Milk","quantity":12,"unit_cost":3.25,"unit_of_measure":"each"},
    {"item_id":"test_item_c","item_name":"Test Cups 12oz","quantity":500,"unit_cost":0.12,"unit_of_measure":"each"}]'::jsonb,
  269.00, 'auto_matched'
)
on conflict (id) do nothing;

-- 6. Empty historical snapshots (last 2 days) so backdated receiving has
--    something to recompute. They start at 0; a backdated invoice received
--    2 days ago will flip them and write inventory_snapshot_audits rows.
insert into public.inventory_snapshots (company_id, snapshot_date, location_id, item_id, quantity_on_hand, unit_cost, day_start_quantity, day_end_quantity, day_start_value, day_end_value)
select '210fc811-6cb3-4c39-9086-1c194b965ea8', d::date, 'test_loc_owc', it.id, 0, it.unit_cost, 0, 0, 0, 0
from public.inventory_items it
cross join generate_series(current_date - 2, current_date - 1, interval '1 day') as d
where it.id in ('test_item_a', 'test_item_b', 'test_item_c')
on conflict (snapshot_date, location_id, item_id) do nothing;

-- ===========================================================================
-- VERIFICATION (run after you Confirm the invoice in the app)
-- ===========================================================================
-- Movements written by receiving:
--   select source_type, item_id, movement_date, quantity_delta, unit_cost
--   from public.inventory_movements
--   where company_id = '210fc811-6cb3-4c39-9086-1c194b965ea8' order by created_date;
--
-- On-hand cache kept in sync:
--   select item_id, on_hand_quantity from public.inventory_location_stock
--   where location_id = 'test_loc_owc';
--
-- Receiving event + lines:
--   select * from public.inventory_receiving_events where location_id = 'test_loc_owc';
--   select * from public.inventory_receiving_lines rl
--     join public.inventory_receiving_events re on re.id = rl.receiving_event_id
--     where re.location_id = 'test_loc_owc';
--
-- Backdated snapshot corrections (only if you set a past Received Date):
--   select snapshot_date, item_id, original_quantity, updated_quantity,
--          original_value, updated_value, reason, invoice_id, changed_at
--   from public.inventory_snapshot_audits order by changed_at desc;

-- ===========================================================================
-- CLEANUP (removes everything this script created)
-- ===========================================================================
-- delete from public.inventory_snapshot_audits where location_id = 'test_loc_owc';
-- delete from public.inventory_movements where location_id = 'test_loc_owc';
-- delete from public.inventory_receiving_lines rl using public.inventory_receiving_events re
--   where rl.receiving_event_id = re.id and re.location_id = 'test_loc_owc';
-- delete from public.inventory_receiving_events where location_id = 'test_loc_owc';
-- delete from public.inventory_snapshots where location_id = 'test_loc_owc';
-- delete from public.inventory_location_stock where location_id = 'test_loc_owc';
-- delete from public.inventory_invoices where id = 'test_inv_owc';
-- delete from public.inventory_order_lines where order_id = 'test_order_owc';
-- delete from public.inventory_orders where id = 'test_order_owc';
-- delete from public.inventory_items where id in ('test_item_a','test_item_b','test_item_c');
-- delete from public.inventory_vendors where id = 'test_vendor_owc';
-- delete from public.locations where id = 'test_loc_owc';
