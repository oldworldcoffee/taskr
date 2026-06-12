-- Unified Location Configuration System (Phase A — additive & reversible).
--
-- Consolidates per-location feature enablement + settings onto the locations row.
-- Adds a third gating layer: a feature shows for a user at a location only when it
-- is enabled at the company (companies.enabled_features) AND at the location (these
-- new flags) AND for the user (users.feature_permissions). The location flag can
-- only NARROW access. The location AND is enforced in the app layer; SQL gating
-- helpers (has_inventory_access/has_financial_access) stay company-scoped.
--
-- Scope is the 4 live modules only: task/checklist, inventory, roastery, financial.
-- Existing per-location settings are absorbed onto the locations row; the source
-- tables (inventory_location_settings, financial_labor_settings) are LEFT IN PLACE
-- so this migration is fully reversible. A later Phase B migration retires them.
--
-- vendor location_settings (inventory_vendors.location_settings) is intentionally
-- NOT absorbed: it is keyed by vendor x location and cannot live on a single
-- location row.

-- 1. New columns on public.locations -----------------------------------------

alter table public.locations
  -- Module enable flags (match the existing is_active style).
  add column if not exists is_task_checklist_enabled boolean not null default true,
  add column if not exists is_inventory_enabled      boolean not null default false,
  add column if not exists is_roastery_enabled       boolean not null default false,
  add column if not exists is_financial_enabled      boolean not null default false,
  -- Inventory absorbed: single typed numeric stays flat; blob reserved for future.
  add column if not exists preferred_stock_weeks   double precision,
  add column if not exists is_commissary           boolean not null default false,
  add column if not exists inventory_settings_json jsonb not null default '{}'::jsonb,
  -- Financial absorbed: ~11 scalars + operating_hours -> one blob (avoid bloating a
  -- table that is select *'d on every auth load; these are read as a settings bag).
  add column if not exists financial_settings_json jsonb not null default '{}'::jsonb,
  -- Roastery: company-only today; reserve per-location blob for symmetry/future.
  add column if not exists roastery_settings_json  jsonb not null default '{}'::jsonb,
  -- Net-new operational fields from spec.
  add column if not exists primary_manager_user_id   text references public.users(id) on delete set null,
  add column if not exists secondary_manager_user_id text references public.users(id) on delete set null,
  add column if not exists notes                     text;

create index if not exists locations_is_commissary_idx
  on public.locations(company_id, is_commissary);

-- 2. Access-preservation backfill (CRITICAL) ---------------------------------
-- The new AND gate would otherwise hide currently-visible features. Widen every
-- existing location to match today's enablement so nothing disappears:
--   * inventory  -> mirrors today's company gate (enabled_features.'inventory').
--   * financial  -> today financial has NO company gate (FinancialLayout checks
--     only the per-user grant), so it is effectively on for every admin/manager.
--     We enable it wherever financial is PROVISIONED (enabled_features OR existing
--     financial_settings / financial_labor_settings rows) so real users keep
--     access; companies that never touched financial no longer surface an empty
--     module (intended per-location behavior, not a regression).
--   * roastery   -> enabled_features.'roastery' OR a roastery/hybrid location,
--     mirroring AuthContext.hasRoasteryLocation.
--   * task/checklist -> always on (it has no gate today).

update public.locations l
set is_inventory_enabled = ('inventory' = any(c.enabled_features)),
    is_financial_enabled = ('financial' = any(c.enabled_features))
                           or exists (select 1 from public.financial_labor_settings f where f.company_id = c.id)
                           or exists (select 1 from public.financial_settings fs where fs.company_id = c.id),
    is_roastery_enabled  = ('roastery'  = any(c.enabled_features))
                           or l.location_type in ('roastery', 'hybrid'),
    is_task_checklist_enabled = true
from public.companies c
where c.id = l.company_id;

-- 3. Absorb inventory_location_settings --------------------------------------
update public.locations l
set preferred_stock_weeks = s.preferred_stock_weeks,
    is_commissary = (s.type = 'commissary'),
    inventory_settings_json = jsonb_build_object('type', s.type)
from public.inventory_location_settings s
where s.location_id = l.id;

-- 4. Absorb per-location financial_labor_settings ----------------------------
-- Only rows with a concrete location_id. NULL-location "company default" rows are
-- vestigial (the codebase has no override->default fallback) and are left in place.
update public.locations l
set financial_settings_json = jsonb_strip_nulls(jsonb_build_object(
      'labor_cost_mode',          f.labor_cost_mode,
      'hourly_rate',              f.hourly_rate,
      'target_labor_pct',         f.target_labor_pct,
      'floor_hourly_rate',        f.floor_hourly_rate,
      'tax_percentage',           f.tax_percentage,
      'benefits_percentage',      f.benefits_percentage,
      'manager_compensation',     f.manager_compensation,
      'manager_hours_allocated',  f.manager_hours_allocated,
      'labor_cost_offset',        f.labor_cost_offset,
      'yearly_sales_offset_pct',  f.yearly_sales_offset_pct,
      'operating_hours',          f.operating_hours
    ))
from public.financial_labor_settings f
where f.location_id = l.id
  and f.location_id is not null;

-- 5. Feature-toggle audit log ------------------------------------------------
create table if not exists public.location_feature_audit (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  location_id text not null references public.locations(id) on delete cascade,
  feature text not null,          -- task_checklist | inventory | roastery | financial
  old_value boolean,
  new_value boolean,
  changed_by text references public.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists location_feature_audit_location_idx
  on public.location_feature_audit(location_id);
create index if not exists location_feature_audit_company_idx
  on public.location_feature_audit(company_id);

alter table public.location_feature_audit enable row level security;

-- Company members read; managers insert. Rows are immutable (no update/delete
-- policy for authenticated; service role bypasses RLS for purges).
drop policy if exists location_feature_audit_select on public.location_feature_audit;
create policy location_feature_audit_select on public.location_feature_audit
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists location_feature_audit_insert on public.location_feature_audit;
create policy location_feature_audit_insert on public.location_feature_audit
  for insert to authenticated with check (public.is_company_manager(company_id));

grant select, insert on public.location_feature_audit to authenticated;

notify pgrst, 'reload schema';
