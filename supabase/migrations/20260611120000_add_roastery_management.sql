-- Roastery Management feature: green coffee sourcing, lots, invoices,
-- release schedule, and pricing tools ported from the Roast & Source app.
--
-- Cross-entity reference columns (green_coffee_id, category_slot_id, etc.)
-- are intentionally plain text without FK constraints so the Roastery Data
-- Tools export/import can recreate records across environments.

create table if not exists public.roastery_settings (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  bag_sizes jsonb not null default '[]'::jsonb,
  pricing_defaults jsonb not null default '{}'::jsonb,
  unique (company_id)
);

create table if not exists public.roastery_green_coffees (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  name text not null,
  coffee_type text not null default 'single_origin',
  blend_components jsonb not null default '[]'::jsonb,
  description text,
  country text,
  region text,
  farm_name text,
  producer text,
  altitude_min double precision,
  altitude_max double precision,
  process text,
  variety text,
  harvest_year text,
  importer text,
  certifications jsonb not null default '[]'::jsonb,
  tasting_notes text,
  farm_story text,
  cupping_score double precision,
  photos jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  sort_order double precision,
  is_active boolean not null default true
);

create table if not exists public.roastery_warehouse_locations (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  name text not null,
  location_type text not null default 'off_site',
  city text,
  state text,
  address text,
  importer text,
  bags_per_pallet double precision,
  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,
  is_active boolean not null default true
);

create table if not exists public.roastery_invoices (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  file_url text,
  file_name text,
  status text not null default 'processing',
  uploaded_by_id text,
  approved_by_id text,
  approved_date date,
  received_by_id text,
  received_date date,
  supplier_name text,
  invoice_number text,
  invoice_date text,
  total_amount double precision,
  freight_total double precision,
  tariff_total double precision,
  storage_fee_total double precision,
  line_items jsonb not null default '[]'::jsonb,
  ai_confidence double precision,
  ai_notes text,
  rejection_reason text,
  notes text
);

create table if not exists public.roastery_inventory_lots (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  green_coffee_id text,
  invoice_id text,
  warehouse_location_id text,
  lot_number text,
  total_lbs_received double precision,
  lbs_on_hand double precision not null default 0,
  lbs_warehoused double precision not null default 0,
  number_of_bags double precision,
  bag_size_kg double precision,
  green_cost_per_lb double precision,
  freight_cost_total double precision,
  tariff_cost_total double precision,
  storage_fee_total double precision,
  landed_cost_per_lb double precision,
  arrival_date text,
  notes text,
  is_active boolean not null default true
);

create table if not exists public.roastery_inventory_adjustments (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  inventory_lot_id text,
  green_coffee_id text,
  adjustment_type text,
  lbs_before double precision,
  lbs_adjusted double precision,
  lbs_after double precision,
  location text,
  adjusted_by_id text,
  reason text,
  adjustment_date text
);

create table if not exists public.roastery_category_slots (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  name text not null,
  category_type text,
  slot_number double precision,
  description text,
  color text,
  slot_prices jsonb not null default '[]'::jsonb,
  sort_order double precision not null default 0,
  is_active boolean not null default true
);

create table if not exists public.roastery_category_rotations (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  category_slot_id text not null,
  green_coffee_id text,
  status text not null default 'coming_soon',
  go_live_date text,
  anticipated_rotation_date text,
  next_green_coffee_id text,
  notes text,
  is_current boolean not null default true
);

create table if not exists public.roastery_blend_component_rotations (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  blend_id text not null,
  component_coffee_id text not null,
  percentage double precision not null default 0,
  status text not null default 'upcoming',
  go_live_date text,
  notes text
);

-- Dynamic per-bag-size fields (bag_cost_*, calc_*, actual_*) live in "data";
-- the client flattens them into the record so bag sizes stay configurable.
create table if not exists public.roastery_pricing_records (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  green_coffee_id text not null,
  category_slot_id text,
  green_cost_per_lb double precision,
  weight_loss_pct double precision,
  target_margin_pct double precision,
  target_retail_margin_pct double precision,
  retail_markup_pct double precision,
  notes text,
  effective_date text,
  data jsonb not null default '{}'::jsonb
);

create index if not exists roastery_settings_company_idx on public.roastery_settings (company_id);
create index if not exists roastery_green_coffees_company_idx on public.roastery_green_coffees (company_id);
create index if not exists roastery_warehouse_locations_company_idx on public.roastery_warehouse_locations (company_id);
create index if not exists roastery_invoices_company_idx on public.roastery_invoices (company_id);
create index if not exists roastery_inventory_lots_company_idx on public.roastery_inventory_lots (company_id);
create index if not exists roastery_inventory_adjustments_company_idx on public.roastery_inventory_adjustments (company_id);
create index if not exists roastery_inventory_adjustments_lot_idx on public.roastery_inventory_adjustments (inventory_lot_id);
create index if not exists roastery_category_slots_company_idx on public.roastery_category_slots (company_id);
create index if not exists roastery_category_rotations_company_idx on public.roastery_category_rotations (company_id);
create index if not exists roastery_category_rotations_slot_idx on public.roastery_category_rotations (category_slot_id);
create index if not exists roastery_blend_component_rotations_company_idx on public.roastery_blend_component_rotations (company_id);
create index if not exists roastery_blend_component_rotations_blend_idx on public.roastery_blend_component_rotations (blend_id);
create index if not exists roastery_pricing_records_company_idx on public.roastery_pricing_records (company_id);
create index if not exists roastery_pricing_records_coffee_idx on public.roastery_pricing_records (green_coffee_id);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'roastery_settings',
    'roastery_green_coffees',
    'roastery_warehouse_locations',
    'roastery_invoices',
    'roastery_inventory_lots',
    'roastery_inventory_adjustments',
    'roastery_category_slots',
    'roastery_category_rotations',
    'roastery_blend_component_rotations',
    'roastery_pricing_records'
  ]
  loop
    execute format('drop trigger if exists set_%I_updated_date on public.%I', table_name, table_name);
    execute format(
      'create trigger set_%I_updated_date before update on public.%I for each row execute function public.set_updated_date()',
      table_name,
      table_name
    );

    execute format('alter table public.%I enable row level security', table_name);

    execute format('drop policy if exists %I_select on public.%I', table_name, table_name);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (public.is_company_member(company_id))',
      table_name,
      table_name
    );

    execute format('drop policy if exists %I_insert on public.%I', table_name, table_name);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (public.is_company_manager(company_id))',
      table_name,
      table_name
    );

    execute format('drop policy if exists %I_update on public.%I', table_name, table_name);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id))',
      table_name,
      table_name
    );

    execute format('drop policy if exists %I_delete on public.%I', table_name, table_name);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (public.is_company_manager(company_id))',
      table_name,
      table_name
    );
  end loop;
end $$;
