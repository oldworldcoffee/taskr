alter table public.inventory_menu_recipes
  add column if not exists drink_base_sizes jsonb not null default '[]'::jsonb,
  add column if not exists drink_service_styles jsonb not null default '[]'::jsonb,
  add column if not exists food_prep_recipe_id text references public.inventory_prep_recipes(id) on delete set null,
  add column if not exists food_prep_quantity double precision not null default 1,
  add column if not exists food_extra_items jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
