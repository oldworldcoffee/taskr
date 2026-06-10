import { isCommissaryLocation } from '@/lib/inventoryLocations';

export function getPreferredPurchaseOption(item) {
  const options = Array.isArray(item?.purchase_options) ? item.purchase_options : [];
  return options.find((option) => option.is_preferred) || options[0] || null;
}

export function getInventoryItemValue(item, onHand, location) {
  const quantity = Number(onHand || 0);
  if (!item || !quantity) return 0;

  const commissaryPrice = Number(item.commissary_price || 0);
  if (item.is_commissary_item && !isCommissaryLocation(location) && commissaryPrice > 0) {
    return quantity * commissaryPrice;
  }

  const preferred = getPreferredPurchaseOption(item);
  const packUnits = Number(preferred?.inner_pack_units || item.inner_pack_units || 1);
  const packsPerCase = Number(preferred?.packs_per_case || item.packs_per_case || 0);
  const unitCost = Number(preferred?.unit_cost || item.unit_cost || 0);

  if (packsPerCase && packUnits) {
    return (quantity / (packUnits * packsPerCase)) * unitCost;
  }

  if (packUnits > 1) {
    return (quantity / packUnits) * unitCost;
  }

  return quantity * unitCost;
}

export function getInventorySnapshotValue(snapshot) {
  if (!snapshot) return 0;
  if (snapshot.inventory_value != null) {
    return Number(snapshot.inventory_value || 0);
  }

  return Number(snapshot.quantity_on_hand || 0) * Number(snapshot.unit_cost || 0);
}
