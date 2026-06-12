-- Financial Management module: labor scheduling + Square sales forecasting.
-- Ported from the standalone "square-link-pro" base44 app. The base44 multi-tenant
-- model (tenant/tenant_member) is dropped in favor of taskr companies + roles; a
-- per-user `financial` grant (users.feature_permissions.financial) mirrors inventory.
--
-- Square connection tokens live in financial_settings (one row per company) and are
-- only ever read/written by the service-role backend (api/_lib/financial.js) — RLS
-- denies all authenticated access so tokens never reach the browser.

-- Link Square locations to taskr's existing locations (matched on connect; unmatched
-- Square locations are created inactive).
alter table public.locations
  add column if not exists square_location_id text;

create table if not exists public.financial_settings (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null unique,
  square_access_token text,
  square_refresh_token text,
  square_token_expires_at text,
  square_merchant_id text,
  square_connected boolean not null default false
);

create table if not exists public.financial_labor_settings (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null,
  location_id text,
  labor_cost_mode text not null default 'simplified',  -- simplified | detailed
  hourly_rate numeric,
  target_labor_pct numeric,
  floor_hourly_rate numeric,
  tax_percentage numeric,
  benefits_percentage numeric,
  manager_compensation numeric,
  manager_hours_allocated numeric,
  labor_cost_offset numeric,
  yearly_sales_offset_pct numeric,
  operating_hours jsonb not null default '{}'::jsonb
);

create table if not exists public.financial_schedules (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null,
  location_id text,
  week_start_date date,
  status text not null default 'draft',  -- draft | published
  is_template boolean not null default false,
  template_effective_from date,
  notes text
);

create table if not exists public.financial_shifts (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null,
  schedule_id text,
  location_id text,
  employee_name text,
  day_of_week integer,  -- 0-6 (Sun-Sat)
  start_time text,
  end_time text,
  hourly_rate numeric,
  notes text,
  display_order integer not null default 0
);

create table if not exists public.financial_sales_cache (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null,
  location_id text,
  metric_type text,  -- quarterly | rolling_3_week
  data jsonb not null default '{}'::jsonb,
  cached_at text,
  period_start text,
  period_end text
);

create index if not exists financial_settings_company_id_idx on public.financial_settings(company_id);
create index if not exists financial_labor_settings_company_id_idx on public.financial_labor_settings(company_id);
create index if not exists financial_labor_settings_location_idx on public.financial_labor_settings(location_id);
create index if not exists financial_schedules_company_id_idx on public.financial_schedules(company_id);
create index if not exists financial_schedules_location_idx on public.financial_schedules(location_id);
create index if not exists financial_shifts_company_id_idx on public.financial_shifts(company_id);
create index if not exists financial_shifts_schedule_idx on public.financial_shifts(schedule_id);
create index if not exists financial_sales_cache_lookup_idx on public.financial_sales_cache(company_id, location_id, metric_type);
create index if not exists locations_square_location_id_idx on public.locations(square_location_id);

-- has_financial_access(): managers/admins always, plus members granted the
-- `financial` feature. Mirrors public.has_inventory_access.
create or replace function public.has_financial_access(row_company_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_company_manager(row_company_id)
    or (
      public.is_company_member(row_company_id)
      and coalesce((
        select (u.feature_permissions -> 'financial') = 'true'::jsonb
            or (u.feature_permissions #> '{financial,enabled}') = 'true'::jsonb
        from public.users u
        where u.id = auth.uid()::text
      ), false)
    )
$$;

alter table public.financial_settings enable row level security;
alter table public.financial_labor_settings enable row level security;
alter table public.financial_schedules enable row level security;
alter table public.financial_shifts enable row level security;
alter table public.financial_sales_cache enable row level security;

-- financial_settings: no policies/grants for authenticated — service role only
-- (it bypasses RLS), so Square tokens are never exposed to the browser.

-- The operational financial tables: company members read; managers + granted
-- users write. Mirrors the todos/inventory RLS idiom.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'financial_labor_settings',
    'financial_schedules',
    'financial_shifts',
    'financial_sales_cache'
  ]
  loop
    execute format('drop policy if exists %I_select on public.%I', table_name, table_name);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (public.is_company_member(company_id))',
      table_name, table_name
    );

    execute format('drop policy if exists %I_insert on public.%I', table_name, table_name);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (public.has_financial_access(company_id))',
      table_name, table_name
    );

    execute format('drop policy if exists %I_update on public.%I', table_name, table_name);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.has_financial_access(company_id)) with check (public.has_financial_access(company_id))',
      table_name, table_name
    );

    execute format('drop policy if exists %I_delete on public.%I', table_name, table_name);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (public.has_financial_access(company_id))',
      table_name, table_name
    );
  end loop;
end $$;

grant select, insert, update, delete on public.financial_labor_settings to authenticated;
grant select, insert, update, delete on public.financial_schedules to authenticated;
grant select, insert, update, delete on public.financial_shifts to authenticated;
grant select, insert, update, delete on public.financial_sales_cache to authenticated;

notify pgrst, 'reload schema';
