-- Rollback for the RBAC redesign:
--   20260613120000_add_rbac_roles_matrix.sql
--   20260613130000_rbac_per_location_rls.sql
--
-- Restores the company-wide RLS on the inventory/financial operational tables
-- (reverting the location-aware "fully hide" policies) and drops the new RBAC
-- tables/columns/functions. users.feature_permissions is untouched and still
-- carries each user's grants, so access reverts cleanly.

-- 1. Restore inventory operational-table policies (per 20260609120000 +
--    20260611200000): company-member SELECT, 1-arg has_inventory_access writes.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'inventory_location_stock', 'inventory_invoices', 'inventory_orders',
    'inventory_counts', 'inventory_snapshots', 'inventory_pool_drawdowns',
    'inventory_transfers', 'inventory_prepaid_pools'
  ]
  loop
    execute format('drop policy if exists %I_select on public.%I', table_name, table_name);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.is_company_member(company_id))', table_name, table_name);
    execute format('drop policy if exists %I_insert on public.%I', table_name, table_name);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.has_inventory_access(company_id))', table_name, table_name);
    execute format('drop policy if exists %I_update on public.%I', table_name, table_name);
    execute format('create policy %I_update on public.%I for update to authenticated using (public.has_inventory_access(company_id)) with check (public.has_inventory_access(company_id))', table_name, table_name);
    execute format('drop policy if exists %I_delete on public.%I', table_name, table_name);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (public.has_inventory_access(company_id))', table_name, table_name);
  end loop;
end $$;

-- 2. Restore financial operational-table policies (per 20260612170000).
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'financial_labor_settings', 'financial_schedules', 'financial_shifts', 'financial_sales_cache'
  ]
  loop
    execute format('drop policy if exists %I_select on public.%I', table_name, table_name);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.is_company_member(company_id))', table_name, table_name);
    execute format('drop policy if exists %I_insert on public.%I', table_name, table_name);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.has_financial_access(company_id))', table_name, table_name);
    execute format('drop policy if exists %I_update on public.%I', table_name, table_name);
    execute format('create policy %I_update on public.%I for update to authenticated using (public.has_financial_access(company_id)) with check (public.has_financial_access(company_id))', table_name, table_name);
    execute format('drop policy if exists %I_delete on public.%I', table_name, table_name);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (public.has_financial_access(company_id))', table_name, table_name);
  end loop;
end $$;

-- 3. Restore the original 1-arg access helpers (read feature_permissions directly).
create or replace function public.has_inventory_access(row_company_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_company_manager(row_company_id)
    or (public.is_company_member(row_company_id)
      and coalesce((select (u.feature_permissions -> 'inventory') = 'true'::jsonb
            or (u.feature_permissions #> '{inventory,enabled}') = 'true'::jsonb
        from public.users u where u.id = auth.uid()::text), false))
$$;

create or replace function public.has_financial_access(row_company_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_company_manager(row_company_id)
    or (public.is_company_member(row_company_id)
      and coalesce((select (u.feature_permissions -> 'financial') = 'true'::jsonb
            or (u.feature_permissions #> '{financial,enabled}') = 'true'::jsonb
        from public.users u where u.id = auth.uid()::text), false))
$$;

-- 4. Drop the new functions, tables, and columns.
drop function if exists public.has_inventory_access(text, text);
drop function if exists public.has_financial_access(text, text);
drop function if exists public.has_module_access(text, text, text);
drop function if exists public.current_role_module_default(text);
drop function if exists public.current_legacy_module_grant(text);

alter table public.users drop column if exists role_id;
alter table public.pending_invites drop column if exists role_id;

drop table if exists public.user_location_module_access;
drop table if exists public.role_module_defaults;
drop table if exists public.roles;

notify pgrst, 'reload schema';
