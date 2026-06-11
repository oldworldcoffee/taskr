-- Rollback for 20260611200000_grant_inventory_write_access.sql
-- Reverts the operational inventory tables to manager-only writes.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'inventory_location_stock',
    'inventory_invoices',
    'inventory_orders',
    'inventory_transfers',
    'inventory_counts',
    'inventory_snapshots',
    'inventory_prepaid_pools',
    'inventory_pool_drawdowns'
  ]
  loop
    execute format('drop policy if exists %I_insert on public.%I', table_name, table_name);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (public.is_company_manager(company_id))',
      table_name, table_name
    );

    execute format('drop policy if exists %I_update on public.%I', table_name, table_name);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id))',
      table_name, table_name
    );

    execute format('drop policy if exists %I_delete on public.%I', table_name, table_name);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (public.is_company_manager(company_id))',
      table_name, table_name
    );
  end loop;
end $$;

drop function if exists public.has_inventory_access(text);

notify pgrst, 'reload schema';
