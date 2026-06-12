-- RBAC: action-level permissions for the Inventory module.
--
-- Inventory access is no longer all-or-nothing. An enabled (user, location,
-- inventory) matrix cell now carries per-action grants in a `perms` jsonb:
--   take_inventory   - counts, stock adjustments, snapshots
--   place_orders     - vendor/commissary orders, order lines, transfers
--   intake_invoices  - invoices, receiving events/lines, pool drawdowns
--   manage_pools     - create/edit prepaid pools
--   manage_catalog   - master catalog: items, vendors, categories, groups,
--                      variants, storage areas (previously manager-only)
-- Enabled with no perms = read-only. Managers/admins auto-grant everything.
-- Inventory location settings stay manager-only.
--
-- The roastery module already had sub-perms in a `roastery_perms` column; this
-- migration renames it to the module-agnostic `perms` (roastery keys unchanged:
-- view_production, manage_production, inventory_adjustments, reporting).

-- ---------------------------------------------------------------------------
-- 1. Rename roastery_perms -> perms (idempotent)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'user_location_module_access'
               and column_name = 'roastery_perms') then
    alter table public.user_location_module_access rename column roastery_perms to perms;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'role_module_defaults'
               and column_name = 'roastery_perms') then
    alter table public.role_module_defaults rename column roastery_perms to perms;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Seed inventory perm templates on the system roles.
--    Supervisor/employee: operate (count/order/intake) but NOT pools/catalog.
--    These templates are the UI defaults when an admin enables the module;
--    role-default `enabled` stays false for emp/supervisor as before.
-- ---------------------------------------------------------------------------
update public.role_module_defaults d
set perms = '{"take_inventory":true,"place_orders":true,"intake_invoices":true,"manage_pools":false,"manage_catalog":false}'::jsonb
from public.roles r
where d.role_id = r.id and r.is_system
  and r.key in ('employee','supervisor')
  and d.module = 'inventory';

update public.role_module_defaults d
set perms = '{"take_inventory":true,"place_orders":true,"intake_invoices":true,"manage_pools":true,"manage_catalog":true}'::jsonb
from public.roles r
where d.role_id = r.id and r.is_system
  and r.key in ('manager','admin','super_admin')
  and d.module = 'inventory';

-- ---------------------------------------------------------------------------
-- 3. Backfill existing inventory matrix rows with the supervisor operational
--    defaults (pools/catalog deliberately OFF per the new policy — previously
--    a blanket inventory grant included pool writes).
-- ---------------------------------------------------------------------------
update public.user_location_module_access
set perms = '{"take_inventory":true,"place_orders":true,"intake_invoices":true,"manage_pools":false,"manage_catalog":false}'::jsonb
where module = 'inventory'
  and (perms is null or perms = '{}'::jsonb);

-- ---------------------------------------------------------------------------
-- 4. Permission resolver. Mirrors has_module_access but checks one action key.
--    Resolution: manager auto-grant -> override row (enabled AND perm) ->
--    role default (enabled AND perm) -> legacy feature_permissions fallback
--    (operational perms only) for users with no matrix rows yet.
-- ---------------------------------------------------------------------------
create or replace function public.current_role_module_default_perm(p_module text, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select d.enabled and coalesce(d.perms ->> p_perm, 'false') = 'true'
    from public.users u
    join public.roles r
      on r.id = coalesce(
           u.role_id,
           (select s.id from public.roles s where s.company_id is null and s.key = u.role limit 1)
         )
    join public.role_module_defaults d on d.role_id = r.id and d.module = p_module
    where u.id = auth.uid()::text
    limit 1
  ), false)
$$;

create or replace function public.current_legacy_module_perm(p_module text, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- Legacy inventory grant was operational-only (catalog/settings were
    -- manager-only); pools follow the NEW policy and are not legacy-granted.
    when p_module = 'inventory' and p_perm in ('take_inventory','place_orders','intake_invoices')
      then public.current_legacy_module_grant('inventory')
    when p_module = 'roastery'
      then coalesce((
        select (u.feature_permissions #> array['roastery', p_perm]) = 'true'::jsonb
        from public.users u where u.id = auth.uid()::text
      ), false)
    else false
  end
$$;

create or replace function public.has_module_perm(row_company_id text, row_location_id text, p_module text, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_company_manager(row_company_id)
    or (
      public.is_company_member(row_company_id)
      and (
        case
          when row_location_id is null then
            public.current_role_module_default_perm(p_module, p_perm)
            or exists (
              select 1 from public.user_location_module_access a
              where a.user_id = auth.uid()::text
                and a.module = p_module
                and a.enabled
                and coalesce(a.perms ->> p_perm, 'false') = 'true'
            )
          else
            coalesce(
              (select a.enabled and coalesce(a.perms ->> p_perm, 'false') = 'true'
                 from public.user_location_module_access a
                where a.user_id = auth.uid()::text
                  and a.location_id = row_location_id
                  and a.module = p_module
                limit 1),
              public.current_role_module_default_perm(p_module, p_perm)
            )
        end
        or (
          not exists (select 1 from public.user_location_module_access a
                       where a.user_id = auth.uid()::text)
          and public.current_legacy_module_perm(p_module, p_perm)
        )
      )
    )
$$;

-- ---------------------------------------------------------------------------
-- 5. Repoint inventory write policies to action perms.
--    SELECT policies stay on has_inventory_access (module enabled = read-only).
-- ---------------------------------------------------------------------------

-- 5a. Single-action tables with a location_id column.
do $$
declare
  rec record;
begin
  for rec in
    select * from (values
      ('inventory_counts',           'take_inventory'),
      ('inventory_orders',           'place_orders'),
      ('inventory_invoices',         'intake_invoices'),
      ('inventory_receiving_events', 'intake_invoices')
    ) as t(table_name, perm)
  loop
    execute format('drop policy if exists %I_insert on public.%I', rec.table_name, rec.table_name);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (public.has_module_perm(company_id, location_id, ''inventory'', %L))',
      rec.table_name, rec.table_name, rec.perm);

    execute format('drop policy if exists %I_update on public.%I', rec.table_name, rec.table_name);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.has_module_perm(company_id, location_id, ''inventory'', %L)) with check (public.has_module_perm(company_id, location_id, ''inventory'', %L))',
      rec.table_name, rec.table_name, rec.perm, rec.perm);

    execute format('drop policy if exists %I_delete on public.%I', rec.table_name, rec.table_name);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (public.has_module_perm(company_id, location_id, ''inventory'', %L))',
      rec.table_name, rec.table_name, rec.perm);
  end loop;
end $$;

-- 5b. Single-action tables WITHOUT a location_id column (company-level perm).
do $$
declare
  rec record;
begin
  for rec in
    select * from (values
      ('inventory_order_lines',     'place_orders'),
      ('inventory_receiving_lines', 'intake_invoices'),
      ('inventory_prepaid_pools',   'manage_pools')
    ) as t(table_name, perm)
  loop
    execute format('drop policy if exists %I_insert on public.%I', rec.table_name, rec.table_name);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (public.has_module_perm(company_id, null, ''inventory'', %L))',
      rec.table_name, rec.table_name, rec.perm);

    execute format('drop policy if exists %I_update on public.%I', rec.table_name, rec.table_name);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.has_module_perm(company_id, null, ''inventory'', %L)) with check (public.has_module_perm(company_id, null, ''inventory'', %L))',
      rec.table_name, rec.table_name, rec.perm, rec.perm);

    execute format('drop policy if exists %I_delete on public.%I', rec.table_name, rec.table_name);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (public.has_module_perm(company_id, null, ''inventory'', %L))',
      rec.table_name, rec.table_name, rec.perm);
  end loop;
end $$;

-- 5c. Stock/ledger tables written by several flows: any operational perm.
do $$
declare
  table_name text;
  cond text;
begin
  foreach table_name in array array[
    'inventory_location_stock',
    'inventory_snapshots',
    'inventory_movements',
    'inventory_snapshot_audits'
  ]
  loop
    cond := format(
      '(public.has_module_perm(company_id, location_id, ''inventory'', ''take_inventory'')
        or public.has_module_perm(company_id, location_id, ''inventory'', ''intake_invoices'')
        or public.has_module_perm(company_id, location_id, ''inventory'', ''place_orders''))');

    execute format('drop policy if exists %I_insert on public.%I', table_name, table_name);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check %s', table_name, table_name, cond);

    execute format('drop policy if exists %I_update on public.%I', table_name, table_name);
    execute format('create policy %I_update on public.%I for update to authenticated using %s with check %s', table_name, table_name, cond, cond);

    execute format('drop policy if exists %I_delete on public.%I', table_name, table_name);
    execute format('create policy %I_delete on public.%I for delete to authenticated using %s', table_name, table_name, cond);
  end loop;
end $$;

-- 5d. Transfers: place_orders or take_inventory at either endpoint.
drop policy if exists inventory_transfers_insert on public.inventory_transfers;
create policy inventory_transfers_insert on public.inventory_transfers
for insert to authenticated
with check (
  public.has_module_perm(company_id, from_location_id, 'inventory', 'place_orders')
  or public.has_module_perm(company_id, to_location_id, 'inventory', 'place_orders')
  or public.has_module_perm(company_id, from_location_id, 'inventory', 'take_inventory')
  or public.has_module_perm(company_id, to_location_id, 'inventory', 'take_inventory')
);

drop policy if exists inventory_transfers_update on public.inventory_transfers;
create policy inventory_transfers_update on public.inventory_transfers
for update to authenticated
using (
  public.has_module_perm(company_id, from_location_id, 'inventory', 'place_orders')
  or public.has_module_perm(company_id, to_location_id, 'inventory', 'place_orders')
  or public.has_module_perm(company_id, from_location_id, 'inventory', 'take_inventory')
  or public.has_module_perm(company_id, to_location_id, 'inventory', 'take_inventory')
)
with check (
  public.has_module_perm(company_id, from_location_id, 'inventory', 'place_orders')
  or public.has_module_perm(company_id, to_location_id, 'inventory', 'place_orders')
  or public.has_module_perm(company_id, from_location_id, 'inventory', 'take_inventory')
  or public.has_module_perm(company_id, to_location_id, 'inventory', 'take_inventory')
);

drop policy if exists inventory_transfers_delete on public.inventory_transfers;
create policy inventory_transfers_delete on public.inventory_transfers
for delete to authenticated
using (
  public.has_module_perm(company_id, from_location_id, 'inventory', 'place_orders')
  or public.has_module_perm(company_id, to_location_id, 'inventory', 'place_orders')
);

-- 5e. Pool drawdowns: created during invoice intake OR direct pool management.
drop policy if exists inventory_pool_drawdowns_insert on public.inventory_pool_drawdowns;
create policy inventory_pool_drawdowns_insert on public.inventory_pool_drawdowns
for insert to authenticated
with check (
  public.has_module_perm(company_id, location_id, 'inventory', 'intake_invoices')
  or public.has_module_perm(company_id, location_id, 'inventory', 'manage_pools')
);

drop policy if exists inventory_pool_drawdowns_update on public.inventory_pool_drawdowns;
create policy inventory_pool_drawdowns_update on public.inventory_pool_drawdowns
for update to authenticated
using (
  public.has_module_perm(company_id, location_id, 'inventory', 'intake_invoices')
  or public.has_module_perm(company_id, location_id, 'inventory', 'manage_pools')
)
with check (
  public.has_module_perm(company_id, location_id, 'inventory', 'intake_invoices')
  or public.has_module_perm(company_id, location_id, 'inventory', 'manage_pools')
);

drop policy if exists inventory_pool_drawdowns_delete on public.inventory_pool_drawdowns;
create policy inventory_pool_drawdowns_delete on public.inventory_pool_drawdowns
for delete to authenticated
using (public.has_module_perm(company_id, location_id, 'inventory', 'manage_pools'));

-- 5f. Master catalog: manager-only -> manager OR manage_catalog grant.
--     (Recipes/pricing/packages and inventory_location_settings stay manager-only.)
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'inventory_items',
    'inventory_vendors',
    'inventory_categories',
    'inventory_product_groups',
    'inventory_item_variants',
    'inventory_storage_areas',
    'inventory_item_storage_areas'
  ]
  loop
    if not exists (select 1 from information_schema.tables t
                   where t.table_schema = 'public' and t.table_name = tbl) then
      continue;
    end if;

    execute format('drop policy if exists %I_insert on public.%I', tbl, tbl);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (public.has_module_perm(company_id, null, ''inventory'', ''manage_catalog''))',
      tbl, tbl);

    execute format('drop policy if exists %I_update on public.%I', tbl, tbl);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.has_module_perm(company_id, null, ''inventory'', ''manage_catalog'')) with check (public.has_module_perm(company_id, null, ''inventory'', ''manage_catalog''))',
      tbl, tbl);

    execute format('drop policy if exists %I_delete on public.%I', tbl, tbl);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (public.has_module_perm(company_id, null, ''inventory'', ''manage_catalog''))',
      tbl, tbl);
  end loop;
end $$;

-- 5g. Read-scope the ledger tables that were still company-member SELECT, to
--     match the fully-hide model from 20260613130000.
drop policy if exists inventory_movements_select on public.inventory_movements;
create policy inventory_movements_select on public.inventory_movements
for select to authenticated
using (public.has_inventory_access(company_id, location_id));

drop policy if exists inventory_receiving_events_select on public.inventory_receiving_events;
create policy inventory_receiving_events_select on public.inventory_receiving_events
for select to authenticated
using (public.has_inventory_access(company_id, location_id));

drop policy if exists inventory_receiving_lines_select on public.inventory_receiving_lines;
create policy inventory_receiving_lines_select on public.inventory_receiving_lines
for select to authenticated
using (public.has_inventory_access(company_id));

drop policy if exists inventory_order_lines_select on public.inventory_order_lines;
create policy inventory_order_lines_select on public.inventory_order_lines
for select to authenticated
using (public.has_inventory_access(company_id));

drop policy if exists inventory_snapshot_audits_select on public.inventory_snapshot_audits;
create policy inventory_snapshot_audits_select on public.inventory_snapshot_audits
for select to authenticated
using (public.has_inventory_access(company_id, location_id));

notify pgrst, 'reload schema';
