-- Inventory ledger write-path.
--
-- record_inventory_movement is the single entry point for changing on-hand
-- stock: it appends one signed row to inventory_movements (the source of
-- truth) and keeps inventory_location_stock.on_hand_quantity in sync as a
-- denormalized cache so all existing reads keep working unchanged.
--
-- Runs SECURITY INVOKER so the caller's RLS still applies: inserting the
-- movement requires company membership and the location_stock upsert requires
-- the existing is_company_manager() policy -- i.e. receiving stays a
-- manager-gated action exactly as it is today.

create or replace function public.record_inventory_movement(
  p_company_id text,
  p_location_id text,
  p_item_id text,
  p_quantity_delta numeric,
  p_unit_cost numeric default 0,
  p_source_type text default 'manual_adjustment',
  p_movement_date date default null,
  p_source_id text default null,
  p_created_by text default null,
  p_notes text default null
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_movement_id text;
  v_date date := coalesce(p_movement_date, now()::date);
  v_user text := coalesce(p_created_by, nullif(auth.uid()::text, ''));
begin
  insert into public.inventory_movements (
    company_id, location_id, item_id, movement_date, quantity_delta,
    unit_cost, source_type, source_id, created_by, notes
  ) values (
    p_company_id, p_location_id, p_item_id, v_date, p_quantity_delta,
    coalesce(p_unit_cost, 0), p_source_type, p_source_id, v_user, p_notes
  )
  returning id into v_movement_id;

  insert into public.inventory_location_stock (
    company_id, location_id, item_id, on_hand_quantity, par_level, reorder_point
  ) values (
    p_company_id, p_location_id, p_item_id, p_quantity_delta, 0, 0
  )
  on conflict (location_id, item_id) do update
    set on_hand_quantity = public.inventory_location_stock.on_hand_quantity
                           + excluded.on_hand_quantity,
        updated_date = now();

  return v_movement_id;
end;
$$;

-- One-time backfill: seed an opening-balance movement for every location/item
-- that currently has non-zero on-hand and has no opening_balance yet, so the
-- ledger reconciles with the existing cached on_hand. The as-of date marks the
-- day the ledger "begins"; backdated corrections before this date have no
-- prior ledger history to recompute. Idempotent.
create or replace function public.backfill_inventory_opening_balances(
  p_company_id text,
  p_as_of date default (now()::date)
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  insert into public.inventory_movements (
    company_id, location_id, item_id, movement_date, quantity_delta,
    unit_cost, source_type, source_id, notes
  )
  select
    s.company_id, s.location_id, s.item_id, p_as_of, s.on_hand_quantity,
    coalesce(i.unit_cost, 0), 'opening_balance', s.id,
    'Ledger opening balance backfill'
  from public.inventory_location_stock s
  left join public.inventory_items i on i.id = s.item_id
  where s.company_id = p_company_id
    and coalesce(s.on_hand_quantity, 0) <> 0
    and not exists (
      select 1 from public.inventory_movements m
      where m.location_id = s.location_id
        and m.item_id = s.item_id
        and m.source_type = 'opening_balance'
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

notify pgrst, 'reload schema';
