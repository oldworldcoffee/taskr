-- Snapshot ledger functions: compute day-start/day-end quantities from the
-- inventory_movements ledger, and recalculate historical snapshots when a
-- backdated movement (e.g. a backdated invoice) lands.

-- Cumulative on-hand per item at a location, as of a date and the day before.
--   day_end_qty   = sum of movement deltas with movement_date <= p_date
--   day_start_qty = sum of movement deltas with movement_date <= p_date - 1
-- Items with no movements up to the date simply don't appear (treated as 0 by
-- the caller, which iterates the active catalog).
create or replace function public.inventory_ledger_quantities(
  p_company_id text,
  p_location_id text,
  p_date date
)
returns table (item_id text, day_end_qty numeric, day_start_qty numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    m.item_id,
    coalesce(sum(m.quantity_delta), 0) as day_end_qty,
    coalesce(sum(m.quantity_delta) filter (where m.movement_date <= p_date - 1), 0) as day_start_qty
  from public.inventory_movements m
  where m.company_id = p_company_id
    and m.location_id = p_location_id
    and m.movement_date <= p_date
  group by m.item_id
$$;

-- Recalculate existing snapshots for a location (optionally scoped to a set of
-- items) from p_from_date forward, recomputing quantities from the ledger while
-- keeping each snapshot's stored unit_cost. Every row whose quantity or value
-- actually changes is written to inventory_snapshot_audits (original vs updated,
-- responsible invoice/receiving event, user, timestamp). Returns the number of
-- snapshot rows changed.
--
-- Note: produces correct results only for dates within the ledger era (on/after
-- the opening-balance backfill date); snapshots predating the ledger have no
-- prior movement history to reconstruct from.
create or replace function public.recalculate_inventory_snapshots(
  p_company_id text,
  p_location_id text,
  p_from_date date,
  p_item_ids text[] default null,
  p_reason text default 'backdated_receiving',
  p_invoice_id text default null,
  p_receiving_event_id text default null,
  p_changed_by text default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item_ids text[];
  v_end_date date;
  v_user text := coalesce(p_changed_by, nullif(auth.uid()::text, ''));
  v_count integer := 0;
  r record;
  v_existing public.inventory_snapshots%rowtype;
  v_found boolean;
  v_end_qty numeric;
  v_start_qty numeric;
  v_cost numeric;
  v_new_end_val numeric;
  v_new_start_val numeric;
  v_old_qty numeric;
  v_old_val numeric;
begin
  -- Items to refresh: the explicit list, else every item with ledger activity
  -- at/after the from date (so a null call also covers backdated receipts of
  -- items that have no snapshot history yet).
  if p_item_ids is null then
    select array_agg(distinct m.item_id) into v_item_ids
    from public.inventory_movements m
    where m.company_id = p_company_id
      and m.location_id = p_location_id
      and m.movement_date >= p_from_date;
  else
    v_item_ids := p_item_ids;
  end if;
  if v_item_ids is null or array_length(v_item_ids, 1) is null then
    return 0;
  end if;

  -- Fill snapshots through the most recent snapshot day for this location
  -- (daily snapshots make that the latest historical day); fall back to
  -- yesterday if none exist yet.
  select max(s.snapshot_date) into v_end_date
  from public.inventory_snapshots s
  where s.company_id = p_company_id and s.location_id = p_location_id;
  if v_end_date is null then
    v_end_date := current_date - 1;
  end if;
  if v_end_date < p_from_date then
    v_end_date := p_from_date;
  end if;

  for r in
    select ids.item_id, it.unit_cost as item_cost, d::date as snapshot_date
    from unnest(v_item_ids) as ids(item_id)
    join public.inventory_items it on it.id = ids.item_id
    cross join generate_series(p_from_date, v_end_date, interval '1 day') as d
  loop
    select coalesce(sum(m.quantity_delta), 0) into v_end_qty
    from public.inventory_movements m
    where m.location_id = p_location_id and m.item_id = r.item_id
      and m.movement_date <= r.snapshot_date;

    select coalesce(sum(m.quantity_delta), 0) into v_start_qty
    from public.inventory_movements m
    where m.location_id = p_location_id and m.item_id = r.item_id
      and m.movement_date <= r.snapshot_date - 1;

    select * into v_existing
    from public.inventory_snapshots s
    where s.company_id = p_company_id and s.location_id = p_location_id
      and s.item_id = r.item_id and s.snapshot_date = r.snapshot_date;
    v_found := found;

    if v_found then
      -- Keep the snapshot's stored unit cost; only correct quantities/values.
      v_cost := coalesce(v_existing.unit_cost, r.item_cost, 0);
      v_old_qty := coalesce(v_existing.quantity_on_hand, 0);
      v_old_val := coalesce(v_existing.day_end_value, v_old_qty * v_cost, 0);
      v_new_end_val := v_end_qty * v_cost;
      v_new_start_val := v_start_qty * v_cost;

      if v_end_qty is distinct from v_old_qty or v_new_end_val is distinct from v_old_val then
        insert into public.inventory_snapshot_audits (
          company_id, snapshot_id, snapshot_date, location_id, item_id,
          original_quantity, original_value, updated_quantity, updated_value,
          reason, invoice_id, receiving_event_id, changed_by
        ) values (
          p_company_id, v_existing.id, r.snapshot_date, p_location_id, r.item_id,
          v_old_qty, v_old_val, v_end_qty, v_new_end_val,
          p_reason, p_invoice_id, p_receiving_event_id, v_user
        );

        update public.inventory_snapshots set
          quantity_on_hand   = v_end_qty,
          day_start_quantity = v_start_qty,
          day_end_quantity   = v_end_qty,
          day_start_value    = v_new_start_val,
          day_end_value      = v_new_end_val,
          is_recalculated    = true,
          recalculated_at    = now(),
          updated_date       = now()
        where id = v_existing.id;

        v_count := v_count + 1;
      end if;
    elsif v_end_qty <> 0 then
      -- No snapshot existed for this item/day: create one so backdated
      -- receiving still shows up in history. Value at the item's current cost.
      v_cost := coalesce(r.item_cost, 0);
      v_new_end_val := v_end_qty * v_cost;
      v_new_start_val := v_start_qty * v_cost;

      insert into public.inventory_snapshots (
        company_id, snapshot_date, location_id, item_id,
        quantity_on_hand, unit_cost,
        day_start_quantity, day_end_quantity, day_start_value, day_end_value,
        is_recalculated, recalculated_at
      ) values (
        p_company_id, r.snapshot_date, p_location_id, r.item_id,
        v_end_qty, v_cost,
        v_start_qty, v_end_qty, v_new_start_val, v_new_end_val,
        true, now()
      );

      insert into public.inventory_snapshot_audits (
        company_id, snapshot_date, location_id, item_id,
        original_quantity, original_value, updated_quantity, updated_value,
        reason, invoice_id, receiving_event_id, changed_by
      ) values (
        p_company_id, r.snapshot_date, p_location_id, r.item_id,
        null, null, v_end_qty, v_new_end_val,
        p_reason, p_invoice_id, p_receiving_event_id, v_user
      );

      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

notify pgrst, 'reload schema';
