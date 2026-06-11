-- Roastery ledger functions (mirror the retail record_inventory_movement /
-- inventory_ledger_quantities / recalculate_inventory_snapshots set).

-- Single write-path: append a signed roastery movement and keep the lot's
-- lbs_on_hand / lbs_warehoused cache in sync. SECURITY INVOKER so the lot cache
-- update is gated by the existing manager RLS on roastery_inventory_lots.
create or replace function public.record_roastery_movement(
  p_company_id text,
  p_inventory_lot_id text,
  p_bucket text,
  p_lbs_delta numeric,
  p_movement_date date default null,
  p_green_cost_per_lb numeric default 0,
  p_landed_cost_per_lb numeric default 0,
  p_source_type text default 'adjustment',
  p_source_id text default null,
  p_green_coffee_id text default null,
  p_warehouse_location_id text default null,
  p_created_by text default null,
  p_notes text default null
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id text;
  v_date date := coalesce(p_movement_date, now()::date);
  v_user text := coalesce(p_created_by, nullif(auth.uid()::text, ''));
begin
  insert into public.roastery_inventory_movements (
    company_id, inventory_lot_id, green_coffee_id, warehouse_location_id,
    movement_date, bucket, lbs_delta, green_cost_per_lb, landed_cost_per_lb,
    source_type, source_id, created_by, notes
  ) values (
    p_company_id, p_inventory_lot_id, p_green_coffee_id, p_warehouse_location_id,
    v_date, p_bucket, p_lbs_delta, coalesce(p_green_cost_per_lb, 0), coalesce(p_landed_cost_per_lb, 0),
    p_source_type, p_source_id, v_user, p_notes
  )
  returning id into v_id;

  if p_bucket = 'on_hand' then
    update public.roastery_inventory_lots
      set lbs_on_hand = coalesce(lbs_on_hand, 0) + p_lbs_delta, updated_date = now()
      where id = p_inventory_lot_id;
  else
    update public.roastery_inventory_lots
      set lbs_warehoused = coalesce(lbs_warehoused, 0) + p_lbs_delta, updated_date = now()
      where id = p_inventory_lot_id;
  end if;

  return v_id;
end;
$$;

-- One-time backfill: seed opening_balance movements from current lot lbs so the
-- ledger reconciles with the cached lot quantities. Idempotent.
create or replace function public.backfill_roastery_opening_balances(
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
  insert into public.roastery_inventory_movements (
    company_id, inventory_lot_id, green_coffee_id, warehouse_location_id,
    movement_date, bucket, lbs_delta, green_cost_per_lb, landed_cost_per_lb,
    source_type, source_id, notes
  )
  select
    l.company_id, l.id, l.green_coffee_id, l.warehouse_location_id,
    p_as_of, b.bucket, b.lbs,
    coalesce(l.green_cost_per_lb, 0), coalesce(l.landed_cost_per_lb, l.green_cost_per_lb, 0),
    'opening_balance', l.id, 'Roastery ledger opening balance backfill'
  from public.roastery_inventory_lots l
  cross join lateral (values
    ('on_hand', coalesce(l.lbs_on_hand, 0)),
    ('warehoused', coalesce(l.lbs_warehoused, 0))
  ) as b(bucket, lbs)
  where l.company_id = p_company_id
    and b.lbs <> 0
    and not exists (
      select 1 from public.roastery_inventory_movements m
      where m.inventory_lot_id = l.id and m.bucket = b.bucket and m.source_type = 'opening_balance'
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Cumulative lbs per lot/bucket as of a date and the day before.
create or replace function public.roastery_ledger_quantities(
  p_company_id text,
  p_date date
)
returns table (
  inventory_lot_id text,
  on_hand_end numeric,
  on_hand_start numeric,
  warehoused_end numeric,
  warehoused_start numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    m.inventory_lot_id,
    coalesce(sum(m.lbs_delta) filter (where m.bucket = 'on_hand'), 0),
    coalesce(sum(m.lbs_delta) filter (where m.bucket = 'on_hand' and m.movement_date <= p_date - 1), 0),
    coalesce(sum(m.lbs_delta) filter (where m.bucket = 'warehoused'), 0),
    coalesce(sum(m.lbs_delta) filter (where m.bucket = 'warehoused' and m.movement_date <= p_date - 1), 0)
  from public.roastery_inventory_movements m
  where m.company_id = p_company_id and m.movement_date <= p_date
  group by m.inventory_lot_id
$$;

-- Recompute roastery snapshots from p_from_date forward (optionally scoped to
-- lots) from the ledger, creating missing rows, auditing every change.
create or replace function public.recalculate_roastery_snapshots(
  p_company_id text,
  p_from_date date,
  p_lot_ids text[] default null,
  p_reason text default 'backdated_roastery',
  p_source_id text default null,
  p_changed_by text default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lot_ids text[];
  v_end_date date;
  v_user text := coalesce(p_changed_by, nullif(auth.uid()::text, ''));
  v_count integer := 0;
  r record;
  v_existing public.roastery_inventory_snapshots%rowtype;
  v_found boolean;
  v_oh_end numeric;
  v_oh_start numeric;
  v_wh_end numeric;
  v_wh_start numeric;
  v_lot public.roastery_inventory_lots%rowtype;
begin
  if p_lot_ids is null then
    select array_agg(distinct m.inventory_lot_id) into v_lot_ids
    from public.roastery_inventory_movements m
    where m.company_id = p_company_id and m.movement_date >= p_from_date;
  else
    v_lot_ids := p_lot_ids;
  end if;
  if v_lot_ids is null or array_length(v_lot_ids, 1) is null then
    return 0;
  end if;

  select max(s.snapshot_date) into v_end_date
  from public.roastery_inventory_snapshots s
  where s.company_id = p_company_id;
  if v_end_date is null then
    v_end_date := current_date - 1;
  end if;
  if v_end_date < p_from_date then
    v_end_date := p_from_date;
  end if;

  for r in
    select ids.lot_id, d::date as snapshot_date
    from unnest(v_lot_ids) as ids(lot_id)
    cross join generate_series(p_from_date, v_end_date, interval '1 day') as d
  loop
    select
      coalesce(sum(m.lbs_delta) filter (where m.bucket = 'on_hand'), 0),
      coalesce(sum(m.lbs_delta) filter (where m.bucket = 'on_hand' and m.movement_date <= r.snapshot_date - 1), 0),
      coalesce(sum(m.lbs_delta) filter (where m.bucket = 'warehoused'), 0),
      coalesce(sum(m.lbs_delta) filter (where m.bucket = 'warehoused' and m.movement_date <= r.snapshot_date - 1), 0)
      into v_oh_end, v_oh_start, v_wh_end, v_wh_start
      from public.roastery_inventory_movements m
      where m.inventory_lot_id = r.lot_id and m.movement_date <= r.snapshot_date;

    select * into v_existing from public.roastery_inventory_snapshots s
      where s.company_id = p_company_id and s.inventory_lot_id = r.lot_id and s.snapshot_date = r.snapshot_date;
    v_found := found;

    if v_found then
      if v_oh_end is distinct from coalesce(v_existing.lbs_on_hand, 0)
         or v_wh_end is distinct from coalesce(v_existing.lbs_warehoused, 0) then
        insert into public.roastery_inventory_snapshot_audits (
          company_id, snapshot_id, snapshot_date, inventory_lot_id,
          original_lbs_on_hand, original_lbs_warehoused, updated_lbs_on_hand, updated_lbs_warehoused,
          reason, source_id, changed_by
        ) values (
          p_company_id, v_existing.id, r.snapshot_date, r.lot_id,
          v_existing.lbs_on_hand, v_existing.lbs_warehoused, v_oh_end, v_wh_end,
          p_reason, p_source_id, v_user
        );
        update public.roastery_inventory_snapshots set
          lbs_on_hand = v_oh_end,
          lbs_warehoused = v_wh_end,
          day_start_lbs_on_hand = v_oh_start,
          day_start_lbs_warehoused = v_wh_start,
          is_recalculated = true,
          recalculated_at = now(),
          updated_date = now()
        where id = v_existing.id;
        v_count := v_count + 1;
      end if;
    elsif v_oh_end <> 0 or v_wh_end <> 0 then
      select * into v_lot from public.roastery_inventory_lots where id = r.lot_id;
      insert into public.roastery_inventory_snapshots (
        company_id, snapshot_date, inventory_lot_id, green_coffee_id, warehouse_location_id,
        lbs_on_hand, lbs_warehoused, green_cost_per_lb, landed_cost_per_lb,
        day_start_lbs_on_hand, day_start_lbs_warehoused, is_recalculated, recalculated_at
      ) values (
        p_company_id, r.snapshot_date, r.lot_id, v_lot.green_coffee_id, v_lot.warehouse_location_id,
        v_oh_end, v_wh_end,
        coalesce(v_lot.green_cost_per_lb, 0), coalesce(v_lot.landed_cost_per_lb, v_lot.green_cost_per_lb, 0),
        v_oh_start, v_wh_start, true, now()
      );
      insert into public.roastery_inventory_snapshot_audits (
        company_id, snapshot_date, inventory_lot_id,
        original_lbs_on_hand, original_lbs_warehoused, updated_lbs_on_hand, updated_lbs_warehoused,
        reason, source_id, changed_by
      ) values (
        p_company_id, r.snapshot_date, r.lot_id, null, null, v_oh_end, v_wh_end, p_reason, p_source_id, v_user
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

notify pgrst, 'reload schema';
