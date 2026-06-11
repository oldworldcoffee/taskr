-- Per-user inventory write access. Until now insert/update/delete on inventory
-- tables required is_company_manager. This lets a non-manager who has been
-- granted the inventory feature (users.feature_permissions.inventory) write to
-- the OPERATIONAL tables (stock, invoices, orders, transfers, counts, snapshots,
-- pools) — the day-to-day receiving/counting flows. The master catalog/config
-- tables (items, vendors, settings, storage areas, recipes) stay manager-only.
--
-- has_inventory_access() returns true for managers/admins (so nobody is locked
-- out) OR for a company member with the inventory grant.

create or replace function public.has_inventory_access(row_company_id text)
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
        select (u.feature_permissions -> 'inventory') = 'true'::jsonb
            or (u.feature_permissions #> '{inventory,enabled}') = 'true'::jsonb
        from public.users u
        where u.id = auth.uid()::text
      ), false)
    )
$$;

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
      'create policy %I_insert on public.%I for insert to authenticated with check (public.has_inventory_access(company_id))',
      table_name, table_name
    );

    execute format('drop policy if exists %I_update on public.%I', table_name, table_name);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.has_inventory_access(company_id)) with check (public.has_inventory_access(company_id))',
      table_name, table_name
    );

    execute format('drop policy if exists %I_delete on public.%I', table_name, table_name);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (public.has_inventory_access(company_id))',
      table_name, table_name
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
