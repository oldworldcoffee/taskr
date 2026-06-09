alter table public.companies
add column if not exists enabled_features text[] not null default '{}'::text[];

create index if not exists companies_enabled_features_idx
on public.companies using gin (enabled_features);

create table if not exists public.inventory_vendors (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  commissary_location_id text references public.locations(id) on delete set null,
  name text not null,
  order_type text not null default 'email',
  contact_name text,
  email text,
  phone text,
  address text,
  notes text,
  is_active boolean not null default true,
  is_commissary boolean not null default false,
  authorized_location_ids text[] not null default '{}'::text[],
  location_settings jsonb not null default '[]'::jsonb,
  default_order_email text,
  default_cc_email text,
  default_min_order_type text not null default 'none',
  default_min_order_value double precision,
  default_delivery_days jsonb not null default '[]'::jsonb,
  delivery_days jsonb not null default '[]'::jsonb
);

create table if not exists public.inventory_items (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  name text not null,
  sku text,
  category text,
  unit_of_measure text,
  unit_cost double precision not null default 0,
  is_commissary_item boolean not null default false,
  commissary_price double precision,
  commissary_vendor_id text,
  description text,
  vendor_id text,
  is_active boolean not null default true,
  purchase_options jsonb not null default '[]'::jsonb,
  count_units jsonb not null default '[]'::jsonb,
  inner_pack_units double precision,
  inner_pack_name text,
  packs_per_case double precision,
  ai_suggested_par double precision,
  minimum_reorder_volume double precision,
  last_par_calculation_date timestamptz
);

create table if not exists public.inventory_location_stock (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  location_id text not null references public.locations(id) on delete cascade,
  item_id text not null references public.inventory_items(id) on delete cascade,
  on_hand_quantity double precision not null default 0,
  par_level double precision not null default 0,
  reorder_point double precision not null default 0,
  unique (location_id, item_id)
);

create table if not exists public.inventory_storage_areas (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  location_id text not null references public.locations(id) on delete cascade,
  name text not null,
  sort_order double precision not null default 0
);

create table if not exists public.inventory_item_storage_areas (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  item_id text not null references public.inventory_items(id) on delete cascade,
  storage_area_id text not null references public.inventory_storage_areas(id) on delete cascade,
  sort_order double precision not null default 0,
  unique (item_id, storage_area_id)
);

create table if not exists public.inventory_counts (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  location_id text not null references public.locations(id) on delete cascade,
  count_type text not null default 'full',
  status text not null default 'in_progress',
  categories text[] not null default '{}'::text[],
  items jsonb not null default '[]'::jsonb,
  submitted_at timestamptz
);

create table if not exists public.inventory_orders (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  type text not null default 'vendor',
  status text not null default 'draft',
  location_id text references public.locations(id) on delete set null,
  vendor_id text references public.inventory_vendors(id) on delete set null,
  order_number text,
  items jsonb not null default '[]'::jsonb,
  total_amount double precision not null default 0,
  notes text,
  viewed_at timestamptz,
  sent_at timestamptz,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  received_at timestamptz,
  backstock_note text,
  email_status text,
  email_log_id text,
  cancellation_email_status text,
  cancellation_email_log_id text
);

create table if not exists public.inventory_commissary_fulfillments (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  order_id text references public.inventory_orders(id) on delete set null,
  order_number text,
  retail_location_id text references public.locations(id) on delete set null,
  commissary_location_id text,
  items jsonb not null default '[]'::jsonb,
  notes text,
  status text not null default 'pending',
  fulfillment_date timestamptz,
  total_amount double precision not null default 0
);

create table if not exists public.inventory_invoices (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  order_id text references public.inventory_orders(id) on delete set null,
  location_id text references public.locations(id) on delete set null,
  vendor_name text,
  invoice_number text,
  invoice_date date,
  status text not null default 'pending_review',
  file_url text,
  image_url text,
  extracted_items jsonb not null default '[]'::jsonb,
  total_amount double precision not null default 0,
  confirmed_at timestamptz,
  rejected_at timestamptz
);

create table if not exists public.inventory_transfers (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  from_location_id text references public.locations(id) on delete set null,
  to_location_id text references public.locations(id) on delete set null,
  transfer_number text,
  items jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  notes text,
  sent_at timestamptz,
  received_at timestamptz,
  total_amount double precision not null default 0
);

create table if not exists public.inventory_snapshots (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  snapshot_date date not null,
  location_id text not null references public.locations(id) on delete cascade,
  item_id text not null references public.inventory_items(id) on delete cascade,
  quantity_on_hand double precision not null default 0,
  unit_cost double precision not null default 0,
  unique (snapshot_date, location_id, item_id)
);

create table if not exists public.inventory_location_settings (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  location_id text not null references public.locations(id) on delete cascade,
  type text not null default 'location',
  preferred_stock_weeks double precision not null default 1,
  unique (location_id)
);

create table if not exists public.inventory_email_logs (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  order_id text references public.inventory_orders(id) on delete set null,
  to_emails text[] not null default '{}'::text[],
  cc_emails text[] not null default '{}'::text[],
  subject text,
  html text,
  status text not null default 'logged',
  provider text not null default 'local-log',
  provider_id text
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'inventory_commissary_fulfillments',
    'inventory_counts',
    'inventory_email_logs',
    'inventory_invoices',
    'inventory_item_storage_areas',
    'inventory_items',
    'inventory_location_settings',
    'inventory_location_stock',
    'inventory_orders',
    'inventory_snapshots',
    'inventory_storage_areas',
    'inventory_transfers',
    'inventory_vendors'
  ]
  loop
    execute format('drop trigger if exists set_%I_updated_date on public.%I', table_name, table_name);
    execute format(
      'create trigger set_%I_updated_date before update on public.%I for each row execute function public.set_updated_date()',
      table_name,
      table_name
    );
  end loop;
end $$;

create index if not exists inventory_vendors_company_id_idx on public.inventory_vendors(company_id);
create unique index if not exists inventory_vendors_commissary_location_id_idx
  on public.inventory_vendors(company_id, commissary_location_id)
  where commissary_location_id is not null;
create index if not exists inventory_items_company_id_idx on public.inventory_items(company_id);
create index if not exists inventory_items_category_idx on public.inventory_items(company_id, category);
create index if not exists inventory_location_stock_company_id_idx on public.inventory_location_stock(company_id);
create index if not exists inventory_location_stock_location_id_idx on public.inventory_location_stock(location_id);
create index if not exists inventory_storage_areas_location_id_idx on public.inventory_storage_areas(location_id);
create index if not exists inventory_item_storage_areas_area_id_idx on public.inventory_item_storage_areas(storage_area_id);
create index if not exists inventory_counts_company_id_idx on public.inventory_counts(company_id);
create index if not exists inventory_counts_location_id_idx on public.inventory_counts(location_id);
create index if not exists inventory_orders_company_id_idx on public.inventory_orders(company_id);
create index if not exists inventory_orders_location_id_idx on public.inventory_orders(location_id);
create index if not exists inventory_orders_status_idx on public.inventory_orders(company_id, status);
create index if not exists inventory_invoices_company_id_idx on public.inventory_invoices(company_id);
create index if not exists inventory_transfers_company_id_idx on public.inventory_transfers(company_id);
create index if not exists inventory_snapshots_lookup_idx on public.inventory_snapshots(snapshot_date, location_id);
create index if not exists inventory_location_settings_company_id_idx on public.inventory_location_settings(company_id);
create index if not exists inventory_email_logs_company_id_idx on public.inventory_email_logs(company_id);

alter table public.inventory_commissary_fulfillments enable row level security;
alter table public.inventory_counts enable row level security;
alter table public.inventory_email_logs enable row level security;
alter table public.inventory_invoices enable row level security;
alter table public.inventory_item_storage_areas enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_location_settings enable row level security;
alter table public.inventory_location_stock enable row level security;
alter table public.inventory_orders enable row level security;
alter table public.inventory_snapshots enable row level security;
alter table public.inventory_storage_areas enable row level security;
alter table public.inventory_transfers enable row level security;
alter table public.inventory_vendors enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'inventory_commissary_fulfillments',
    'inventory_counts',
    'inventory_email_logs',
    'inventory_invoices',
    'inventory_item_storage_areas',
    'inventory_items',
    'inventory_location_settings',
    'inventory_location_stock',
    'inventory_orders',
    'inventory_snapshots',
    'inventory_storage_areas',
    'inventory_transfers',
    'inventory_vendors'
  ]
  loop
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

grant select, insert, update, delete on all tables in schema public to authenticated;
