-- RBAC redesign — Phase 2: repoint RLS on the inventory + financial OPERATIONAL
-- tables from company-wide (is_company_member / is_company_manager / 1-arg
-- has_*_access) to the per-(user,location,module) helpers from Phase 1.
--
-- "Fully hide" semantics: a user who is not granted a module at a location can
-- neither read nor write that location's operational rows. Managers/admins keep
-- full company access via is_company_manager inside has_module_access.
--
-- Scope notes:
--   * Catalog/config tables (inventory_items, inventory_vendors, categories,
--     storage areas, location settings, recipes) are intentionally LEFT company-
--     scoped — they are shared definitions the whole app needs, not per-location
--     operational activity.
--   * Roastery tables have no public.locations FK (only warehouse_location_id to
--     roastery_warehouse_locations) and roastery is a single company-wide
--     operation, so they are LEFT company-scoped this pass; roastery sub-perms
--     stay enforced in the app layer (hasRoasteryPermission).
--   * inventory_prepaid_pools has no location_id -> uses the 1-arg ("anywhere")
--     helper. inventory_transfers has from/to -> granted at EITHER endpoint.

-- ---------------------------------------------------------------------------
-- Inventory operational tables with a single location_id column.
-- (orders/invoices have nullable location_id; NULL resolves to "anywhere".)
-- ---------------------------------------------------------------------------
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'inventory_location_stock',
    'inventory_invoices',
    'inventory_orders',
    'inventory_counts',
    'inventory_snapshots',
    'inventory_pool_drawdowns'
  ]
  loop
    execute format('drop policy if exists %I_select on public.%I', table_name, table_name);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (public.has_inventory_access(company_id, location_id))',
      table_name, table_name);

    execute format('drop policy if exists %I_insert on public.%I', table_name, table_name);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (public.has_inventory_access(company_id, location_id))',
      table_name, table_name);

    execute format('drop policy if exists %I_update on public.%I', table_name, table_name);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.has_inventory_access(company_id, location_id)) with check (public.has_inventory_access(company_id, location_id))',
      table_name, table_name);

    execute format('drop policy if exists %I_delete on public.%I', table_name, table_name);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (public.has_inventory_access(company_id, location_id))',
      table_name, table_name);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- inventory_transfers: two endpoints. A user needs the inventory module at the
-- source OR destination location.
-- ---------------------------------------------------------------------------
drop policy if exists inventory_transfers_select on public.inventory_transfers;
create policy inventory_transfers_select on public.inventory_transfers
for select to authenticated
using (public.has_inventory_access(company_id, from_location_id)
    or public.has_inventory_access(company_id, to_location_id));

drop policy if exists inventory_transfers_insert on public.inventory_transfers;
create policy inventory_transfers_insert on public.inventory_transfers
for insert to authenticated
with check (public.has_inventory_access(company_id, from_location_id)
         or public.has_inventory_access(company_id, to_location_id));

drop policy if exists inventory_transfers_update on public.inventory_transfers;
create policy inventory_transfers_update on public.inventory_transfers
for update to authenticated
using (public.has_inventory_access(company_id, from_location_id)
    or public.has_inventory_access(company_id, to_location_id))
with check (public.has_inventory_access(company_id, from_location_id)
         or public.has_inventory_access(company_id, to_location_id));

drop policy if exists inventory_transfers_delete on public.inventory_transfers;
create policy inventory_transfers_delete on public.inventory_transfers
for delete to authenticated
using (public.has_inventory_access(company_id, from_location_id)
    or public.has_inventory_access(company_id, to_location_id));

-- ---------------------------------------------------------------------------
-- inventory_prepaid_pools: no location_id -> company-wide "anywhere" grant.
-- ---------------------------------------------------------------------------
drop policy if exists inventory_prepaid_pools_select on public.inventory_prepaid_pools;
create policy inventory_prepaid_pools_select on public.inventory_prepaid_pools
for select to authenticated
using (public.has_inventory_access(company_id));

drop policy if exists inventory_prepaid_pools_insert on public.inventory_prepaid_pools;
create policy inventory_prepaid_pools_insert on public.inventory_prepaid_pools
for insert to authenticated
with check (public.has_inventory_access(company_id));

drop policy if exists inventory_prepaid_pools_update on public.inventory_prepaid_pools;
create policy inventory_prepaid_pools_update on public.inventory_prepaid_pools
for update to authenticated
using (public.has_inventory_access(company_id))
with check (public.has_inventory_access(company_id));

drop policy if exists inventory_prepaid_pools_delete on public.inventory_prepaid_pools;
create policy inventory_prepaid_pools_delete on public.inventory_prepaid_pools
for delete to authenticated
using (public.has_inventory_access(company_id));

-- ---------------------------------------------------------------------------
-- Financial operational tables (all have nullable location_id).
-- financial_settings stays service-role-only (Square tokens) — untouched.
-- ---------------------------------------------------------------------------
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
      'create policy %I_select on public.%I for select to authenticated using (public.has_financial_access(company_id, location_id))',
      table_name, table_name);

    execute format('drop policy if exists %I_insert on public.%I', table_name, table_name);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (public.has_financial_access(company_id, location_id))',
      table_name, table_name);

    execute format('drop policy if exists %I_update on public.%I', table_name, table_name);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.has_financial_access(company_id, location_id)) with check (public.has_financial_access(company_id, location_id))',
      table_name, table_name);

    execute format('drop policy if exists %I_delete on public.%I', table_name, table_name);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (public.has_financial_access(company_id, location_id))',
      table_name, table_name);
  end loop;
end $$;

notify pgrst, 'reload schema';
