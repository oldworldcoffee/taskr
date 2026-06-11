import { supabase } from '@/api/supabaseClient';

// Single client-side entry point for changing on-hand stock. Calls the
// record_inventory_movement RPC, which appends to the inventory_movements
// ledger (source of truth) and keeps inventory_location_stock.on_hand_quantity
// in sync. Returns the new movement id.
//
// sourceType: 'receipt' | 'transfer_in' | 'transfer_out' | 'production'
//           | 'manual_adjustment' | 'count_reconcile' | 'pool_draw'
//           | 'opening_balance' | 'void'
// movementDate is the effective/received date (yyyy-MM-dd) that drives all
// historical inventory math; defaults to today server-side when null.
export async function recordMovement({
  companyId,
  locationId,
  itemId,
  quantityDelta,
  unitCost = 0,
  sourceType = 'manual_adjustment',
  movementDate = null,
  sourceId = null,
  notes = null,
}) {
  if (!companyId || !locationId || !itemId) {
    throw new Error('recordMovement requires companyId, locationId and itemId');
  }
  const { data, error } = await supabase.rpc('record_inventory_movement', {
    p_company_id: companyId,
    p_location_id: locationId,
    p_item_id: itemId,
    p_quantity_delta: quantityDelta,
    p_unit_cost: unitCost || 0,
    p_source_type: sourceType,
    p_movement_date: movementDate,
    p_source_id: sourceId,
    p_notes: notes,
  });
  if (error) throw new Error(error.message || 'Failed to record inventory movement');
  return data;
}

// Recompute historical snapshots for a location from `fromDate` forward after a
// backdated movement (e.g. a backdated invoice), writing inventory_snapshot_audits
// for every changed row. Pass itemIds to scope to the affected items. Returns the
// number of snapshot rows changed.
export async function recalculateSnapshots({
  companyId,
  locationId,
  fromDate,
  itemIds = null,
  reason = 'backdated_receiving',
  invoiceId = null,
  receivingEventId = null,
}) {
  if (!companyId || !locationId || !fromDate) {
    throw new Error('recalculateSnapshots requires companyId, locationId and fromDate');
  }
  const { data, error } = await supabase.rpc('recalculate_inventory_snapshots', {
    p_company_id: companyId,
    p_location_id: locationId,
    p_from_date: fromDate,
    p_item_ids: itemIds,
    p_reason: reason,
    p_invoice_id: invoiceId,
    p_receiving_event_id: receivingEventId,
  });
  if (error) throw new Error(error.message || 'Failed to recalculate snapshots');
  return data;
}
