create table if not exists public.inventory_categories (
  id text primary key default gen_random_uuid()::text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  company_id text not null references public.companies(id) on delete cascade,
  name text not null,
  main_category text not null default 'ingredient'
    check (main_category in ('sales_item', 'ingredient', 'supply')),
  include_in_recipe_pricing boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  unique (company_id, name)
);

drop trigger if exists set_inventory_categories_updated_date on public.inventory_categories;
create trigger set_inventory_categories_updated_date
before update on public.inventory_categories
for each row execute function public.set_updated_date();

create index if not exists inventory_categories_company_id_idx
  on public.inventory_categories(company_id);
create index if not exists inventory_categories_main_category_idx
  on public.inventory_categories(company_id, main_category);

alter table public.inventory_categories enable row level security;

drop policy if exists inventory_categories_select on public.inventory_categories;
create policy inventory_categories_select on public.inventory_categories
for select to authenticated
using (public.is_company_member(company_id));

drop policy if exists inventory_categories_insert on public.inventory_categories;
create policy inventory_categories_insert on public.inventory_categories
for insert to authenticated
with check (public.is_company_manager(company_id));

drop policy if exists inventory_categories_update on public.inventory_categories;
create policy inventory_categories_update on public.inventory_categories
for update to authenticated
using (public.is_company_manager(company_id))
with check (public.is_company_manager(company_id));

drop policy if exists inventory_categories_delete on public.inventory_categories;
create policy inventory_categories_delete on public.inventory_categories
for delete to authenticated
using (public.is_company_manager(company_id));

grant select, insert, update, delete on public.inventory_categories to authenticated;

notify pgrst, 'reload schema';
