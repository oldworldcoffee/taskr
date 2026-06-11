-- Order / Receiving Event / Invoice model + inventory movements ledger.
--
-- Establishes the foundation for partial receiving, multi-invoice orders,
-- backdated inventory corrections, and day-start/day-end snapshots:
--
--   Order
--    └── Receiving Events (one physical shipment arrival)
--         └── Receiving Lines  -> inventory_movements (the ledger)
--   Order <── many Invoices (attached directly and/or to a receiving event)
--
-- This migration is ADDITIVE and non-breaking: existing orders, invoices,
-- and the current invoice-confirm receiving path keep working unchanged.
-- The movements ledger and receiving events sit alongside the existing
-- mutable inventory_location_stock until Phase 2 wires the write-path in.

-- ---------------------------------------------------------------------------
-- 1. Orders: line-item statuses, partial-receiving + matching metadata.
-- ---------------------------------------------------------------------------
-- Order statuses (string, not enforced via check to avoid breaking existing
-- 'draft'/'sent' rows): draft, sent, ordered, partially_received,
-- fully_received, closed, cancelled.
alter table public.inventory_orders
  add column if not exists po_number text,
  add column if not exists vendor_reference text,
  add column if not exists ordered_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by text references public.users(id) on delete set null,
  add column if not exists close_reason text;

create index if not exists inventory_orders_po_number_idx
  on public.inventory_orders(company_id, po_number);

-- Normalized order lines so ordered-vs-received quantities and per-line
-- statuses can be tracked and queried. The existing inventory_orders.items
-- jsonb stays as-is for backward compatibility; Phase 2 backfills these rows.
create table if not exists public.inventory_order_lines (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  order_id text not null references public.inventory_orders(id) on delete cascade,
  item_id text references public.inventory_items(id) on delete set null,
  item_name text,
  unit_of_measure text,
  purchase_option jsonb,
  ordered_quantity numeric not null default 0,
  received_quantity numeric not null default 0,
  unit_cost numeric not null default 0,
  -- pending | received | backordered | cancelled_by_vendor | not_received | substitute_received
  status text not null default 'pending'
    check (status in ('pending', 'received', 'backordered',
                      'cancelled_by_vendor', 'not_received', 'substitute_received')),
  substitute_item_id text references public.inventory_items(id) on delete set null,
  notes text,
  sort_order numeric not null default 0
);

drop trigger if exists set_inventory_order_lines_updated_date on public.inventory_order_lines;
create trigger set_inventory_order_lines_updated_date
before update on public.inventory_order_lines
for each row execute function public.set_updated_date();

create index if not exists inventory_order_lines_company_id_idx
  on public.inventory_order_lines(company_id);
create index if not exists inventory_order_lines_order_id_idx
  on public.inventory_order_lines(order_id);
create index if not exists inventory_order_lines_item_id_idx
  on public.inventory_order_lines(item_id);

-- ---------------------------------------------------------------------------
-- 2. Receiving events: one per physical shipment arrival against an order.
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_receiving_events (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  order_id text references public.inventory_orders(id) on delete set null,
  location_id text references public.locations(id) on delete set null,
  -- Date the goods physically arrived. PRIMARY date for inventory math.
  received_date date not null default (now()::date),
  received_at timestamptz not null default now(),
  received_by text references public.users(id) on delete set null,
  reference text,            -- shipment / tracking / packing-slip reference
  status text not null default 'received'
    check (status in ('received', 'partial', 'void')),
  notes text
);

drop trigger if exists set_inventory_receiving_events_updated_date on public.inventory_receiving_events;
create trigger set_inventory_receiving_events_updated_date
before update on public.inventory_receiving_events
for each row execute function public.set_updated_date();

create index if not exists inventory_receiving_events_company_id_idx
  on public.inventory_receiving_events(company_id);
create index if not exists inventory_receiving_events_order_id_idx
  on public.inventory_receiving_events(order_id);
create index if not exists inventory_receiving_events_date_idx
  on public.inventory_receiving_events(company_id, location_id, received_date);

-- Lines actually received within a receiving event. These drive the ledger.
create table if not exists public.inventory_receiving_lines (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  receiving_event_id text not null references public.inventory_receiving_events(id) on delete cascade,
  order_line_id text references public.inventory_order_lines(id) on delete set null,
  item_id text references public.inventory_items(id) on delete set null,
  quantity_received numeric not null default 0,
  unit_cost numeric not null default 0,
  -- received | substitute_received | backordered | cancelled_by_vendor | not_received
  line_status text not null default 'received'
    check (line_status in ('received', 'substitute_received', 'backordered',
                           'cancelled_by_vendor', 'not_received')),
  substitute_item_id text references public.inventory_items(id) on delete set null,
  notes text
);

drop trigger if exists set_inventory_receiving_lines_updated_date on public.inventory_receiving_lines;
create trigger set_inventory_receiving_lines_updated_date
before update on public.inventory_receiving_lines
for each row execute function public.set_updated_date();

create index if not exists inventory_receiving_lines_company_id_idx
  on public.inventory_receiving_lines(company_id);
create index if not exists inventory_receiving_lines_event_id_idx
  on public.inventory_receiving_lines(receiving_event_id);
create index if not exists inventory_receiving_lines_item_id_idx
  on public.inventory_receiving_lines(item_id);

-- ---------------------------------------------------------------------------
-- 3. Invoices: many-per-order, three dates, receiving-event link, matching.
-- ---------------------------------------------------------------------------
-- invoice_date  : date printed on the vendor invoice (defaults to today).
-- received_date : date goods physically arrived; PRIMARY for inventory math.
-- entry_date    : date the invoice was uploaded into taskr; audit only.
alter table public.inventory_invoices
  add column if not exists receiving_event_id text
    references public.inventory_receiving_events(id) on delete set null,
  add column if not exists received_date date,
  add column if not exists entry_date date not null default (now()::date),
  add column if not exists po_number text,
  add column if not exists vendor_reference text,
  -- unmatched | auto_matched | manually_matched | no_order
  -- ('no_order' added in 20260611180000 for par-based deliveries with no PO)
  add column if not exists match_status text not null default 'unmatched'
    check (match_status in ('unmatched', 'auto_matched', 'manually_matched', 'no_order')),
  add column if not exists matched_at timestamptz,
  add column if not exists matched_by text references public.users(id) on delete set null;

create index if not exists inventory_invoices_order_id_idx
  on public.inventory_invoices(order_id);
create index if not exists inventory_invoices_receiving_event_idx
  on public.inventory_invoices(receiving_event_id);
create index if not exists inventory_invoices_match_status_idx
  on public.inventory_invoices(company_id, match_status);
create index if not exists inventory_invoices_received_date_idx
  on public.inventory_invoices(company_id, location_id, received_date);

-- ---------------------------------------------------------------------------
-- 4. Inventory movements ledger: the new source of truth.
-- ---------------------------------------------------------------------------
-- Every change to on-hand is one signed, dated movement. on_hand at any date
-- = sum(quantity_delta) where movement_date <= date. Day-start/day-end and
-- backdated recalculation are derived from this table. unit_cost captures the
-- cost effective on movement_date for valuation.
create table if not exists public.inventory_movements (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  location_id text not null references public.locations(id) on delete cascade,
  item_id text not null references public.inventory_items(id) on delete cascade,
  -- Effective/business date that drives all historical inventory math.
  movement_date date not null,
  quantity_delta numeric not null,
  unit_cost numeric not null default 0,
  -- receipt | transfer_in | transfer_out | production | manual_adjustment
  -- | count_reconcile | pool_draw | opening_balance | void
  source_type text not null
    check (source_type in ('receipt', 'transfer_in', 'transfer_out', 'production',
                           'manual_adjustment', 'count_reconcile', 'pool_draw',
                           'opening_balance', 'void')),
  source_id text,           -- id of the receiving_line / transfer / count / etc.
  created_by text references public.users(id) on delete set null,
  notes text
);

drop trigger if exists set_inventory_movements_updated_date on public.inventory_movements;
create trigger set_inventory_movements_updated_date
before update on public.inventory_movements
for each row execute function public.set_updated_date();

create index if not exists inventory_movements_company_id_idx
  on public.inventory_movements(company_id);
-- Primary access pattern: roll up an item at a location across a date range.
create index if not exists inventory_movements_rollup_idx
  on public.inventory_movements(company_id, location_id, item_id, movement_date);
create index if not exists inventory_movements_date_idx
  on public.inventory_movements(company_id, movement_date);
create index if not exists inventory_movements_source_idx
  on public.inventory_movements(source_type, source_id);

-- ---------------------------------------------------------------------------
-- 5. Snapshots: day-start / day-end + recalculation audit trail.
-- ---------------------------------------------------------------------------
-- Existing quantity_on_hand / unit_cost columns are retained and treated as
-- the day-end values for backward compatibility.
alter table public.inventory_snapshots
  add column if not exists day_start_quantity numeric,
  add column if not exists day_end_quantity numeric,
  add column if not exists day_start_value numeric,
  add column if not exists day_end_value numeric,
  add column if not exists is_recalculated boolean not null default false,
  add column if not exists recalculated_at timestamptz;

-- Audit trail for backdated corrections: records the before/after of any
-- snapshot row that a backdated movement forced us to recompute.
create table if not exists public.inventory_snapshot_audits (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  snapshot_id text references public.inventory_snapshots(id) on delete set null,
  snapshot_date date not null,
  location_id text references public.locations(id) on delete set null,
  item_id text references public.inventory_items(id) on delete set null,
  original_quantity numeric,
  original_value numeric,
  updated_quantity numeric,
  updated_value numeric,
  -- What forced the recalculation.
  reason text not null default 'backdated_receiving',
  invoice_id text references public.inventory_invoices(id) on delete set null,
  receiving_event_id text references public.inventory_receiving_events(id) on delete set null,
  changed_by text references public.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

drop trigger if exists set_inventory_snapshot_audits_updated_date on public.inventory_snapshot_audits;
create trigger set_inventory_snapshot_audits_updated_date
before update on public.inventory_snapshot_audits
for each row execute function public.set_updated_date();

create index if not exists inventory_snapshot_audits_company_id_idx
  on public.inventory_snapshot_audits(company_id);
create index if not exists inventory_snapshot_audits_lookup_idx
  on public.inventory_snapshot_audits(company_id, snapshot_date, location_id, item_id);
create index if not exists inventory_snapshot_audits_invoice_idx
  on public.inventory_snapshot_audits(invoice_id);

-- ---------------------------------------------------------------------------
-- 6. Location types: retail / roastery / hybrid.
-- ---------------------------------------------------------------------------
-- A 'roastery' or 'hybrid' location auto-enables roastery functionality and
-- is the anchor for production activity, time tracking, and reporting filters.
alter table public.locations
  add column if not exists location_type text not null default 'retail'
    check (location_type in ('retail', 'roastery', 'hybrid'));

create index if not exists locations_location_type_idx
  on public.locations(company_id, location_type);

-- ---------------------------------------------------------------------------
-- 7. Per-user feature access & roastery permissions.
-- ---------------------------------------------------------------------------
-- Organization-level toggles already live in companies.enabled_features.
-- feature_permissions holds the per-user grants, e.g.:
--   {
--     "inventory": true,
--     "roastery": {
--       "enabled": true,
--       "view_production": true,
--       "manage_production": false,
--       "inventory_adjustments": false,
--       "reporting": true
--     }
--   }
alter table public.users
  add column if not exists feature_permissions jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 8. Row level security (matches existing inventory tables).
-- ---------------------------------------------------------------------------
alter table public.inventory_order_lines enable row level security;
drop policy if exists inventory_order_lines_select on public.inventory_order_lines;
create policy inventory_order_lines_select on public.inventory_order_lines
for select using (public.is_company_member(company_id));
drop policy if exists inventory_order_lines_insert on public.inventory_order_lines;
create policy inventory_order_lines_insert on public.inventory_order_lines
for insert with check (public.is_company_member(company_id));
drop policy if exists inventory_order_lines_update on public.inventory_order_lines;
create policy inventory_order_lines_update on public.inventory_order_lines
for update using (public.is_company_member(company_id))
with check (public.is_company_member(company_id));
drop policy if exists inventory_order_lines_delete on public.inventory_order_lines;
create policy inventory_order_lines_delete on public.inventory_order_lines
for delete using (public.is_company_member(company_id));

alter table public.inventory_receiving_events enable row level security;
drop policy if exists inventory_receiving_events_select on public.inventory_receiving_events;
create policy inventory_receiving_events_select on public.inventory_receiving_events
for select using (public.is_company_member(company_id));
drop policy if exists inventory_receiving_events_insert on public.inventory_receiving_events;
create policy inventory_receiving_events_insert on public.inventory_receiving_events
for insert with check (public.is_company_member(company_id));
drop policy if exists inventory_receiving_events_update on public.inventory_receiving_events;
create policy inventory_receiving_events_update on public.inventory_receiving_events
for update using (public.is_company_member(company_id))
with check (public.is_company_member(company_id));
drop policy if exists inventory_receiving_events_delete on public.inventory_receiving_events;
create policy inventory_receiving_events_delete on public.inventory_receiving_events
for delete using (public.is_company_manager(company_id));

alter table public.inventory_receiving_lines enable row level security;
drop policy if exists inventory_receiving_lines_select on public.inventory_receiving_lines;
create policy inventory_receiving_lines_select on public.inventory_receiving_lines
for select using (public.is_company_member(company_id));
drop policy if exists inventory_receiving_lines_insert on public.inventory_receiving_lines;
create policy inventory_receiving_lines_insert on public.inventory_receiving_lines
for insert with check (public.is_company_member(company_id));
drop policy if exists inventory_receiving_lines_update on public.inventory_receiving_lines;
create policy inventory_receiving_lines_update on public.inventory_receiving_lines
for update using (public.is_company_member(company_id))
with check (public.is_company_member(company_id));
drop policy if exists inventory_receiving_lines_delete on public.inventory_receiving_lines;
create policy inventory_receiving_lines_delete on public.inventory_receiving_lines
for delete using (public.is_company_member(company_id));

alter table public.inventory_movements enable row level security;
drop policy if exists inventory_movements_select on public.inventory_movements;
create policy inventory_movements_select on public.inventory_movements
for select using (public.is_company_member(company_id));
drop policy if exists inventory_movements_insert on public.inventory_movements;
create policy inventory_movements_insert on public.inventory_movements
for insert with check (public.is_company_member(company_id));
-- Movements are an append-only ledger: updates/deletes restricted to managers
-- (corrections are normally recorded as offsetting movements).
drop policy if exists inventory_movements_update on public.inventory_movements;
create policy inventory_movements_update on public.inventory_movements
for update using (public.is_company_manager(company_id))
with check (public.is_company_manager(company_id));
drop policy if exists inventory_movements_delete on public.inventory_movements;
create policy inventory_movements_delete on public.inventory_movements
for delete using (public.is_company_manager(company_id));

alter table public.inventory_snapshot_audits enable row level security;
drop policy if exists inventory_snapshot_audits_select on public.inventory_snapshot_audits;
create policy inventory_snapshot_audits_select on public.inventory_snapshot_audits
for select using (public.is_company_member(company_id));
drop policy if exists inventory_snapshot_audits_insert on public.inventory_snapshot_audits;
create policy inventory_snapshot_audits_insert on public.inventory_snapshot_audits
for insert with check (public.is_company_member(company_id));
-- Audit rows are immutable once written.
drop policy if exists inventory_snapshot_audits_update on public.inventory_snapshot_audits;
create policy inventory_snapshot_audits_update on public.inventory_snapshot_audits
for update using (false) with check (false);
drop policy if exists inventory_snapshot_audits_delete on public.inventory_snapshot_audits;
create policy inventory_snapshot_audits_delete on public.inventory_snapshot_audits
for delete using (public.is_company_manager(company_id));
