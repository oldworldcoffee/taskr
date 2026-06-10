import { getPreferredPurchaseOption } from '@/lib/inventoryValue';

// Prepaid pools: bulk purchases the vendor warehouses, drawn down by $0
// drop-off invoices at the pool's locked unit cost. Drawdowns carry invoice_id,
// so a future invoice un-confirm can delete by invoice and the DB trigger will
// restore remaining_quantity.

function isCaseUom(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  return ['cs', 'case', 'cases'].includes(normalized);
}

export function activePoolsForItem(pools = [], itemId) {
  return pools
    .filter((pool) => pool.item_id === itemId && pool.status === 'active')
    .sort((a, b) => String(a.purchased_date || a.created_date || '').localeCompare(String(b.purchased_date || b.created_date || '')));
}

// Converts an invoice line quantity into the item's base units (eaches) so it
// can be drawn against a pool. Case lines multiply by pack structure from the
// matched purchase option (or the item's preferred option / item-level fields).
// Pool-linked options are skipped: their pack fields are per-base-unit (1/1)
// and carry no case structure.
export function lineBaseQuantity(row = {}, item = {}, matchedOption = null) {
  const quantity = Number(row.quantity || 0);
  if (!quantity || !isCaseUom(row.unit_of_measure)) return quantity;

  const option = [matchedOption, getPreferredPurchaseOption(item), ...(item.purchase_options || [])]
    .find((candidate) => candidate && !candidate.pool_id) || null;
  const packUnits = Number(option?.inner_pack_units || item.inner_pack_units || 1) || 1;
  const packsPerCase = Number(option?.packs_per_case || item.packs_per_case || 0);

  if (packsPerCase) return quantity * packUnits * packsPerCase;
  if (packUnits > 1) return quantity * packUnits;
  return quantity;
}

// --- Pool-linked purchase options -----------------------------------------
// While a pool is active, the item's costing (recipes, inventory value) should
// use the pool's locked cost. Costing reads the preferred purchase option, so
// we represent the pool as a purchase option carrying pool_id. Pack fields are
// 1/1 so the unit cost reads as per base unit in getInventoryItemValue().

export function findPoolPurchaseOption(item) {
  return (item?.purchase_options || []).find((option) => option.pool_id) || null;
}

export function buildPoolPurchaseOption(pool, item) {
  return {
    pool_id: pool.id,
    vendor_id: pool.vendor_id || '',
    vendor_name: pool.vendor_name || 'Prepaid Pool',
    product_name: `${item?.name || 'Pool'}${pool.label ? ` — ${pool.label}` : ''}`,
    product_code: '',
    unit_cost: Number(pool.unit_cost || 0),
    unit_of_measure: pool.unit_of_measure || item?.unit_of_measure || 'EA',
    inner_pack_uom: pool.unit_of_measure || item?.unit_of_measure || 'EA',
    inner_pack_units: 1,
    inner_pack_name: '',
    packs_per_case: 1,
    is_preferred: true,
    notes: 'Prepaid pool — locked cost',
    location_ids: null,
  };
}

// Returns a purchase_options array with this pool as the (only) pool option,
// preferred; all other options are un-preferred but kept for ordering.
export function applyPoolPurchaseOption(item, pool) {
  const others = (item?.purchase_options || [])
    .filter((option) => !option.pool_id)
    .map((option) => ({ ...option, is_preferred: false }));
  return [buildPoolPurchaseOption(pool, item), ...others];
}

// Removes any pool-linked options. If one of them was preferred, the first
// remaining option is promoted so the item keeps a preferred option.
export function removePoolPurchaseOption(item) {
  const options = item?.purchase_options || [];
  const poolOptions = options.filter((option) => option.pool_id);
  if (!poolOptions.length) return null;
  const remaining = options.filter((option) => !option.pool_id);
  if (poolOptions.some((option) => option.is_preferred) && remaining.length && !remaining.some((option) => option.is_preferred)) {
    remaining[0] = { ...remaining[0], is_preferred: true };
  }
  return remaining;
}

// FIFO allocation across a list of active pools (oldest first). Overdraw
// beyond all pools is charged to the newest pool so its remaining quantity
// goes negative and the discrepancy stays visible instead of dropping cost.
export function allocateDrawdowns(pools = [], baseQty) {
  let remainingToDraw = Number(baseQty || 0);
  if (remainingToDraw <= 0 || !pools.length) return [];

  const allocations = [];
  for (const pool of pools) {
    if (remainingToDraw <= 0) break;
    const available = Math.max(Number(pool.remaining_quantity || 0), 0);
    const drawn = Math.min(available, remainingToDraw);
    if (drawn > 0) {
      allocations.push({ pool, quantity: drawn });
      remainingToDraw -= drawn;
    }
  }

  if (remainingToDraw > 0) {
    const lastPool = pools[pools.length - 1];
    const existing = allocations.find((allocation) => allocation.pool.id === lastPool.id);
    if (existing) existing.quantity += remainingToDraw;
    else allocations.push({ pool: lastPool, quantity: remainingToDraw });
  }

  return allocations;
}

export function poolRemainingValue(pool) {
  return Math.max(Number(pool?.remaining_quantity || 0), 0) * Number(pool?.unit_cost || 0);
}

export function poolUnitCost(totalCost, totalQuantity) {
  const quantity = Number(totalQuantity || 0);
  return quantity > 0 ? Number(totalCost || 0) / quantity : 0;
}
