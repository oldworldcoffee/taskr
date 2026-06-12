-- Rollback for 20260613140000_add_inventory_action_perms.sql
-- Restores module-level (non-action) inventory RLS from 20260613130000 and the
-- manager-only catalog policies, renames perms back to roastery_perms, and
-- drops the perm-resolver functions.

-- 1. Operational tables back to module-level access.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'inventory_location_stock', 'inventory_invoices', 'inventory_orders',
    'inventory_counts', 'inventory_snapshots', 'inventory_pool_drawdowns'
  ]
  loop
    execute format('drop policy if exists %I_insert on public.%I', table_name, table_name);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.has_inventory_access(company_id, location_id))', table_name, table_name);
    execute format('drop policy if exists %I_update on public.%I', table_name, table_name);
    execute format('create policy %I_update on public.%I for update to authenticated using (public.has_inventory_access(company_id, location_id)) with check (public.has_inventory_access(company_id, location_id))', table_name, table_name);
    execute format('drop policy if exists %I_delete on public.%I', table_name, table_name);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (public.has_inventory_access(company_id, location_id))', table_name, table_name);
  end loop;
end $$;

drop policy if exists inventory_transfers_insert on public.inventory_transfers;
create policy inventory_transfers_insert on public.inventory_transfers
for insert to authenticated
with check (public.has_inventory_access(company_id, from_location_id) or public.has_inventory_access(company_id, to_location_id));
drop policy if exists inventory_transfers_update on public.inventory_transfers;
create policy inventory_transfers_update on public.inventory_transfers
for update to authenticated
using (public.has_inventory_access(company_id, from_location_id) or public.has_inventory_access(company_id, to_location_id))
with check (public.has_inventory_access(company_id, from_location_id) or public.has_inventory_access(company_id, to_location_id));
drop policy if exists inventory_transfers_delete on public.inventory_transfers;
create policy inventory_transfers_delete on public.inventory_transfers
for delete to authenticated
using (public.has_inventory_access(company_id, from_location_id) or public.has_inventory_access(company_id, to_location_id));

drop policy if exists inventory_prepaid_pools_insert on public.inventory_prepaid_pools;
create policy inventory_prepaid_pools_insert on public.inventory_prepaid_pools
for insert to authenticated with check (public.has_inventory_access(company_id));
drop policy if exists inventory_prepaid_pools_update on public.inventory_prepaid_pools;
create policy inventory_prepaid_pools_update on public.inventory_prepaid_pools
for update to authenticated using (public.has_inventory_access(company_id)) with check (public.has_inventory_access(company_id));
drop policy if exists inventory_prepaid_pools_delete on public.inventory_prepaid_pools;
create policy inventory_prepaid_pools_delete on public.inventory_prepaid_pools
for delete to authenticated using (public.has_inventory_access(company_id));

-- 2. Catalog tables back to manager-only writes.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'inventory_items', 'inventory_vendors', 'inventory_categories',
    'inventory_product_groups', 'inventory_item_variants',
    'inventory_storage_areas', 'inventory_item_storage_areas'
  ]
  loop
    if not exists (select 1 from information_schema.tables t
                   where t.table_schema = 'public' and t.table_name = tbl) then
      continue;
    end if;
    execute format('drop policy if exists %I_insert on public.%I', tbl, tbl);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.is_company_manager(company_id))', tbl, tbl);
    execute format('drop policy if exists %I_update on public.%I', tbl, tbl);
    execute format('create policy %I_update on public.%I for update to authenticated using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id))', tbl, tbl);
    execute format('drop policy if exists %I_delete on public.%I', tbl, tbl);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (public.is_company_manager(company_id))', tbl, tbl);
  end loop;
end $$;

-- 3. Ledger tables back to company-member writes/reads (pre-RBAC state from
--    20260611150000/20260611210000).
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'inventory_order_lines', 'inventory_receiving_events', 'inventory_receiving_lines',
    'inventory_movements', 'inventory_snapshot_audits'
  ]
  loop
    execute format('drop policy if exists %I_select on public.%I', tbl, tbl);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.is_company_member(company_id))', tbl, tbl);
    execute format('drop policy if exists %I_insert on public.%I', tbl, tbl);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.is_company_member(company_id))', tbl, tbl);
    execute format('drop policy if exists %I_update on public.%I', tbl, tbl);
    execute format('create policy %I_update on public.%I for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id))', tbl, tbl);
    execute format('drop policy if exists %I_delete on public.%I', tbl, tbl);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (public.is_company_manager(company_id))', tbl, tbl);
  end loop;
end $$;

-- 4. Drop perm functions and rename the column back.
drop function if exists public.has_module_perm(text, text, text, text);
drop function if exists public.current_role_module_default_perm(text, text);
drop function if exists public.current_legacy_module_perm(text, text);

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'user_location_module_access'
               and column_name = 'perms') then
    alter table public.user_location_module_access rename column perms to roastery_perms;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'role_module_defaults'
               and column_name = 'perms') then
    alter table public.role_module_defaults rename column perms to roastery_perms;
  end if;
end $$;

notify pgrst, 'reload schema';
