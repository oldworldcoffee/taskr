import { supabase } from '@/api/supabaseClient';

// Single client entry point for changing roastery lot lbs. Calls the
// record_roastery_movement RPC, which appends to roastery_inventory_movements
// (source of truth) and keeps the lot's lbs_on_hand / lbs_warehoused cache in
// sync. Returns the new movement id.
//
// bucket: 'on_hand' | 'warehoused'
// sourceType: 'receipt' | 'production' | 'adjustment' | 'transfer_warehouse'
//           | 'opening_balance' | 'void'
// movementDate is the effective date (yyyy-MM-dd) driving historical roastery
// inventory; defaults to today server-side when null.
export async function recordRoasteryMovement({
  companyId,
  inventoryLotId,
  bucket,
  lbsDelta,
  movementDate = null,
  greenCostPerLb = 0,
  landedCostPerLb = 0,
  sourceType = 'adjustment',
  sourceId = null,
  greenCoffeeId = null,
  warehouseLocationId = null,
  notes = null,
}) {
  if (!companyId || !inventoryLotId || !bucket) {
    throw new Error('recordRoasteryMovement requires companyId, inventoryLotId and bucket');
  }
  const { data, error } = await supabase.rpc('record_roastery_movement', {
    p_company_id: companyId,
    p_inventory_lot_id: inventoryLotId,
    p_bucket: bucket,
    p_lbs_delta: lbsDelta,
    p_movement_date: movementDate,
    p_green_cost_per_lb: greenCostPerLb || 0,
    p_landed_cost_per_lb: landedCostPerLb || 0,
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_green_coffee_id: greenCoffeeId,
    p_warehouse_location_id: warehouseLocationId,
    p_notes: notes,
  });
  if (error) throw new Error(error.message || 'Failed to record roastery movement');
  return data;
}

// Recompute roastery snapshots from `fromDate` forward after a backdated
// movement, writing roastery_inventory_snapshot_audits for changed rows.
// Returns the number of snapshot rows changed.
export async function recalculateRoasterySnapshots({
  companyId,
  fromDate,
  lotIds = null,
  reason = 'backdated_roastery',
  sourceId = null,
}) {
  if (!companyId || !fromDate) {
    throw new Error('recalculateRoasterySnapshots requires companyId and fromDate');
  }
  const { data, error } = await supabase.rpc('recalculate_roastery_snapshots', {
    p_company_id: companyId,
    p_from_date: fromDate,
    p_lot_ids: lotIds,
    p_reason: reason,
    p_source_id: sourceId,
  });
  if (error) throw new Error(error.message || 'Failed to recalculate roastery snapshots');
  return data;
}
