create table if not exists public.inventory_recipe_size_sets (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  name text not null,
  category text,
  description text,
  sizes jsonb not null default '[]'::jsonb,
  is_active boolean not null default true
);

create table if not exists public.inventory_recipe_choice_groups (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  name text not null,
  category text,
  description text,
  size_set_id text references public.inventory_recipe_size_sets(id) on delete set null,
  unit_of_measure text not null default 'fl-oz',
  amounts jsonb not null default '{}'::jsonb,
  options jsonb not null default '[]'::jsonb,
  is_active boolean not null default true
);

create table if not exists public.inventory_recipe_modifiers (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  name text not null,
  category text,
  description text,
  size_set_id text references public.inventory_recipe_size_sets(id) on delete set null,
  upcharge double precision not null default 0,
  lines jsonb not null default '[]'::jsonb,
  is_active boolean not null default true
);

alter table public.inventory_menu_recipes
  add column if not exists size_set_id text references public.inventory_recipe_size_sets(id) on delete set null,
  add column if not exists selected_size_ids jsonb not null default '[]'::jsonb,
  add column if not exists size_prices jsonb not null default '{}'::jsonb,
  add column if not exists choice_group_ids jsonb not null default '[]'::jsonb,
  add column if not exists modifier_ids jsonb not null default '[]'::jsonb;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'inventory_recipe_size_sets',
    'inventory_recipe_choice_groups',
    'inventory_recipe_modifiers'
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

create index if not exists inventory_recipe_size_sets_company_id_idx on public.inventory_recipe_size_sets(company_id);
create index if not exists inventory_recipe_size_sets_category_idx on public.inventory_recipe_size_sets(company_id, category);
create index if not exists inventory_recipe_choice_groups_company_id_idx on public.inventory_recipe_choice_groups(company_id);
create index if not exists inventory_recipe_choice_groups_size_set_id_idx on public.inventory_recipe_choice_groups(size_set_id);
create index if not exists inventory_recipe_modifiers_company_id_idx on public.inventory_recipe_modifiers(company_id);
create index if not exists inventory_recipe_modifiers_size_set_id_idx on public.inventory_recipe_modifiers(size_set_id);
create index if not exists inventory_menu_recipes_size_set_id_idx on public.inventory_menu_recipes(size_set_id);

alter table public.inventory_recipe_size_sets enable row level security;
alter table public.inventory_recipe_choice_groups enable row level security;
alter table public.inventory_recipe_modifiers enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'inventory_recipe_size_sets',
    'inventory_recipe_choice_groups',
    'inventory_recipe_modifiers'
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
