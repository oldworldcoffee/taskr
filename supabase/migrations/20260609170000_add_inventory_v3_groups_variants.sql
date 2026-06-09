create table if not exists public.inventory_product_groups (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order double precision not null default 0
);

create table if not exists public.inventory_item_variants (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  item_id text not null references public.inventory_items(id) on delete cascade,
  variant_name text not null,
  sort_order double precision not null default 0,
  unit_cost double precision,
  sku text
);

alter table public.inventory_items
  add column if not exists product_group_id text references public.inventory_product_groups(id) on delete set null,
  add column if not exists group_sort_order double precision not null default 0;

alter table public.inventory_counts
  add column if not exists submitted_by text;

alter table public.inventory_orders
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_read_at timestamptz,
  add column if not exists sent_to_email text;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'inventory_product_groups',
    'inventory_item_variants'
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

create index if not exists inventory_product_groups_company_id_idx on public.inventory_product_groups(company_id);
create index if not exists inventory_item_variants_company_id_idx on public.inventory_item_variants(company_id);
create index if not exists inventory_item_variants_item_id_idx on public.inventory_item_variants(item_id);
create index if not exists inventory_items_product_group_id_idx on public.inventory_items(product_group_id);

alter table public.inventory_product_groups enable row level security;
alter table public.inventory_item_variants enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'inventory_product_groups',
    'inventory_item_variants'
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

notify pgrst, 'reload schema';
