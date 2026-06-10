-- Force-enable the Inventory module for Old World Coffee Roasters.
--
-- Run this in the Supabase SQL editor if the Super Admin toggle shows Inventory
-- as enabled but the Old World Coffee Roasters dashboard still says Inventory Off.

update public.companies
set
  enabled_features = (
    select array_agg(distinct feature)
    from unnest(coalesce(enabled_features, '{}'::text[]) || array['inventory']::text[]) as feature
  ),
  updated_date = now()
where lower(trim(name)) = lower('Old World Coffee Roasters')
returning id, name, enabled_features;
