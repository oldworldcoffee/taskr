create table if not exists public.inventory_recipe_margin_settings (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  category text not null,
  target_margin double precision not null default 0.75,
  waste_margin double precision not null default 0.05,
  yellow_margin_points double precision not null default 0.05,
  unique (company_id, category)
);

create table if not exists public.inventory_packages (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  name text not null,
  category text,
  description text,
  lines jsonb not null default '[]'::jsonb,
  is_active boolean not null default true
);

create table if not exists public.inventory_prep_recipes (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  name text not null,
  category text,
  description text,
  yield_quantity double precision not null default 1,
  yield_uom text,
  lines jsonb not null default '[]'::jsonb,
  is_active boolean not null default true
);

create table if not exists public.inventory_menu_recipes (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  name text not null,
  category text,
  description text,
  sizes jsonb not null default '[]'::jsonb,
  drink_base_sizes jsonb not null default '[]'::jsonb,
  drink_service_styles jsonb not null default '[]'::jsonb,
  food_prep_recipe_id text references public.inventory_prep_recipes(id) on delete set null,
  food_prep_quantity double precision not null default 1,
  food_extra_items jsonb not null default '[]'::jsonb,
  components jsonb not null default '[]'::jsonb,
  modifiers jsonb not null default '[]'::jsonb,
  target_margin_override double precision,
  waste_margin_override double precision,
  set_pricing jsonb not null default '{}'::jsonb,
  is_active boolean not null default true
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'inventory_recipe_margin_settings',
    'inventory_packages',
    'inventory_prep_recipes',
    'inventory_menu_recipes'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', 'set_' || table_name || '_updated_date', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_date()',
      'set_' || table_name || '_updated_date',
      table_name
    );
  end loop;
end $$;

create index if not exists inventory_recipe_margin_settings_company_id_idx on public.inventory_recipe_margin_settings(company_id);
create index if not exists inventory_recipe_margin_settings_category_idx on public.inventory_recipe_margin_settings(company_id, category);
create index if not exists inventory_packages_company_id_idx on public.inventory_packages(company_id);
create index if not exists inventory_packages_category_idx on public.inventory_packages(company_id, category);
create index if not exists inventory_prep_recipes_company_id_idx on public.inventory_prep_recipes(company_id);
create index if not exists inventory_prep_recipes_category_idx on public.inventory_prep_recipes(company_id, category);
create index if not exists inventory_menu_recipes_company_id_idx on public.inventory_menu_recipes(company_id);
create index if not exists inventory_menu_recipes_category_idx on public.inventory_menu_recipes(company_id, category);

alter table public.inventory_recipe_margin_settings enable row level security;
alter table public.inventory_packages enable row level security;
alter table public.inventory_prep_recipes enable row level security;
alter table public.inventory_menu_recipes enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'inventory_recipe_margin_settings',
    'inventory_packages',
    'inventory_prep_recipes',
    'inventory_menu_recipes'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_select', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_company_member(company_id))',
      table_name || '_select',
      table_name
    );

    execute format('drop policy if exists %I on public.%I', table_name || '_insert', table_name);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_company_manager(company_id))',
      table_name || '_insert',
      table_name
    );

    execute format('drop policy if exists %I on public.%I', table_name || '_update', table_name);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id))',
      table_name || '_update',
      table_name
    );

    execute format('drop policy if exists %I on public.%I', table_name || '_delete', table_name);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_company_manager(company_id))',
      table_name || '_delete',
      table_name
    );
  end loop;
end $$;

grant select, insert, update, delete on all tables in schema public to authenticated;

notify pgrst, 'reload schema';
