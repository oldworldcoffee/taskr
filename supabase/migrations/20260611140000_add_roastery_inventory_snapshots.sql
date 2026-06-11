-- Day-end roastery inventory snapshots: one row per lot per day capturing
-- on-hand/warehoused lbs and costs, written by the nightly snapshot cron
-- (same job as inventory_snapshots) so usage and accounting reports can
-- look at retained point-in-time data instead of reconstructing it from
-- adjustment history.
--
-- Like other roastery tables, lot/coffee/warehouse references are plain
-- text (no FK) so Roastery Data Tools export/import works across
-- environments and snapshots survive lot deletion.

create table if not exists public.roastery_inventory_snapshots (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  snapshot_date date not null,
  inventory_lot_id text not null,
  green_coffee_id text,
  warehouse_location_id text,
  lbs_on_hand double precision not null default 0,
  lbs_warehoused double precision not null default 0,
  green_cost_per_lb double precision not null default 0,
  landed_cost_per_lb double precision not null default 0,
  unique (snapshot_date, inventory_lot_id)
);

create index if not exists roastery_inventory_snapshots_lookup_idx
  on public.roastery_inventory_snapshots (company_id, snapshot_date);

drop trigger if exists set_roastery_inventory_snapshots_updated_date on public.roastery_inventory_snapshots;
create trigger set_roastery_inventory_snapshots_updated_date
  before update on public.roastery_inventory_snapshots
  for each row execute function public.set_updated_date();

alter table public.roastery_inventory_snapshots enable row level security;

drop policy if exists roastery_inventory_snapshots_select on public.roastery_inventory_snapshots;
create policy roastery_inventory_snapshots_select on public.roastery_inventory_snapshots
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists roastery_inventory_snapshots_insert on public.roastery_inventory_snapshots;
create policy roastery_inventory_snapshots_insert on public.roastery_inventory_snapshots
  for insert to authenticated with check (public.is_company_manager(company_id));

drop policy if exists roastery_inventory_snapshots_update on public.roastery_inventory_snapshots;
create policy roastery_inventory_snapshots_update on public.roastery_inventory_snapshots
  for update to authenticated using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));

drop policy if exists roastery_inventory_snapshots_delete on public.roastery_inventory_snapshots;
create policy roastery_inventory_snapshots_delete on public.roastery_inventory_snapshots
  for delete to authenticated using (public.is_company_manager(company_id));

notify pgrst, 'reload schema';
