-- Roastery inventory ledger — brings green-coffee inventory to parity with the
-- retail inventory_movements ledger. Every lbs change to a lot (receipts,
-- production consumption, adjustments, warehouse<->roastery transfers) becomes a
-- signed, dated movement. roastery_inventory_lots.lbs_on_hand / lbs_warehoused
-- become caches kept in sync by the ledger, and roastery snapshots become
-- ledger-derived so backdated receipts/adjustments recompute history.
--
-- Lots track two buckets (on_hand at the roastery, warehoused off-site); a
-- movement names which bucket it changes. inventory_lot_id is plain text (no FK)
-- so movements/snapshots survive lot deletion, matching roastery_inventory_snapshots.

create table if not exists public.roastery_inventory_movements (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  inventory_lot_id text not null,
  green_coffee_id text,
  warehouse_location_id text,
  movement_date date not null,
  -- which lot bucket this movement changes
  bucket text not null check (bucket in ('on_hand', 'warehoused')),
  lbs_delta numeric not null,
  green_cost_per_lb numeric not null default 0,
  landed_cost_per_lb numeric not null default 0,
  -- receipt | production | adjustment | transfer_warehouse | opening_balance | void
  source_type text not null
    check (source_type in ('receipt', 'production', 'adjustment',
                           'transfer_warehouse', 'opening_balance', 'void')),
  source_id text,
  created_by text references public.users(id) on delete set null,
  notes text
);

drop trigger if exists set_roastery_inventory_movements_updated_date on public.roastery_inventory_movements;
create trigger set_roastery_inventory_movements_updated_date
before update on public.roastery_inventory_movements
for each row execute function public.set_updated_date();

create index if not exists roastery_inventory_movements_company_id_idx
  on public.roastery_inventory_movements(company_id);
create index if not exists roastery_inventory_movements_rollup_idx
  on public.roastery_inventory_movements(company_id, inventory_lot_id, bucket, movement_date);
create index if not exists roastery_inventory_movements_date_idx
  on public.roastery_inventory_movements(company_id, movement_date);
create index if not exists roastery_inventory_movements_source_idx
  on public.roastery_inventory_movements(source_type, source_id);

-- Audit trail of backdated snapshot corrections (mirrors inventory_snapshot_audits).
create table if not exists public.roastery_inventory_snapshot_audits (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  snapshot_id text,
  snapshot_date date not null,
  inventory_lot_id text,
  original_lbs_on_hand numeric,
  original_lbs_warehoused numeric,
  updated_lbs_on_hand numeric,
  updated_lbs_warehoused numeric,
  reason text not null default 'backdated_roastery',
  source_id text,
  changed_by text references public.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

drop trigger if exists set_roastery_inventory_snapshot_audits_updated_date on public.roastery_inventory_snapshot_audits;
create trigger set_roastery_inventory_snapshot_audits_updated_date
before update on public.roastery_inventory_snapshot_audits
for each row execute function public.set_updated_date();

create index if not exists roastery_inventory_snapshot_audits_lookup_idx
  on public.roastery_inventory_snapshot_audits(company_id, snapshot_date, inventory_lot_id);

-- Day-start columns on the existing snapshot table (lbs_on_hand/lbs_warehoused
-- are retained as the day-end values for backward compatibility).
alter table public.roastery_inventory_snapshots
  add column if not exists day_start_lbs_on_hand numeric,
  add column if not exists day_start_lbs_warehoused numeric,
  add column if not exists is_recalculated boolean not null default false,
  add column if not exists recalculated_at timestamptz;

-- RLS (matches roastery convention: member select, manager write; movements
-- insert is member-level like the retail ledger, gated in practice by the lot
-- cache update which stays manager-only).
alter table public.roastery_inventory_movements enable row level security;
drop policy if exists roastery_inventory_movements_select on public.roastery_inventory_movements;
create policy roastery_inventory_movements_select on public.roastery_inventory_movements
for select to authenticated using (public.is_company_member(company_id));
drop policy if exists roastery_inventory_movements_insert on public.roastery_inventory_movements;
create policy roastery_inventory_movements_insert on public.roastery_inventory_movements
for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists roastery_inventory_movements_update on public.roastery_inventory_movements;
create policy roastery_inventory_movements_update on public.roastery_inventory_movements
for update to authenticated using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));
drop policy if exists roastery_inventory_movements_delete on public.roastery_inventory_movements;
create policy roastery_inventory_movements_delete on public.roastery_inventory_movements
for delete to authenticated using (public.is_company_manager(company_id));

alter table public.roastery_inventory_snapshot_audits enable row level security;
drop policy if exists roastery_inventory_snapshot_audits_select on public.roastery_inventory_snapshot_audits;
create policy roastery_inventory_snapshot_audits_select on public.roastery_inventory_snapshot_audits
for select to authenticated using (public.is_company_member(company_id));
drop policy if exists roastery_inventory_snapshot_audits_insert on public.roastery_inventory_snapshot_audits;
create policy roastery_inventory_snapshot_audits_insert on public.roastery_inventory_snapshot_audits
for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists roastery_inventory_snapshot_audits_update on public.roastery_inventory_snapshot_audits;
create policy roastery_inventory_snapshot_audits_update on public.roastery_inventory_snapshot_audits
for update to authenticated using (false) with check (false);
drop policy if exists roastery_inventory_snapshot_audits_delete on public.roastery_inventory_snapshot_audits;
create policy roastery_inventory_snapshot_audits_delete on public.roastery_inventory_snapshot_audits
for delete to authenticated using (public.is_company_manager(company_id));

notify pgrst, 'reload schema';
