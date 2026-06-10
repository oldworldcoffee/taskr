-- Rollback for 20260611130000_add_prepaid_inventory_pools.sql
drop table if exists public.inventory_pool_drawdowns;
drop table if exists public.inventory_prepaid_pools;
drop function if exists public.recalculate_pool_remaining();
drop function if exists public.initialize_pool_remaining();

notify pgrst, 'reload schema';
