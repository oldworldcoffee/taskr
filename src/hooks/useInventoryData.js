import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

const MINUTE = 60 * 1000;

// Columns needed by getInventoryItemValue plus the fields the overview pages
// render. Editing screens (e.g. MasterCatalog) need full rows and should not
// use these trimmed queries.
export const VALUE_ITEM_FIELDS = [
  'id',
  'name',
  'category',
  'is_active',
  'unit_cost',
  'purchase_options',
  'inner_pack_units',
  'packs_per_case',
  'is_commissary_item',
  'commissary_price',
];

export const STOCK_LEVEL_FIELDS = [
  'id',
  'item_id',
  'location_id',
  'on_hand_quantity',
  'par_level',
];

const ORDER_SUMMARY_FIELDS = [
  'id',
  'order_number',
  'type',
  'status',
  'total_amount',
  'created_date',
];

export const inventoryKeys = {
  locations: ['inventory', 'locations'],
  locationSettings: ['inventory', 'location-settings'],
  valueItems: ['inventory', 'items', 'value'],
  stockLevels: ['inventory', 'stock', 'levels'],
  recentOrders: (limit) => ['inventory', 'orders', 'recent', limit],
  recentTransfers: (limit) => ['inventory', 'transfers', 'recent', limit],
  pendingInvoices: ['inventory', 'invoices', 'pending'],
  snapshotsByDate: (date) => ['inventory', 'snapshots', date],
  catalog: (companyId) => ['inventory', 'catalog', companyId || 'none'],
  prepaidPools: ['inventory', 'prepaid-pools', 'active'],
};

export function useLocations() {
  return useQuery({
    queryKey: inventoryKeys.locations,
    queryFn: () => base44.entities.Location.list(),
    staleTime: 5 * MINUTE,
  });
}

export function useInventoryLocationSettings() {
  return useQuery({
    queryKey: inventoryKeys.locationSettings,
    queryFn: () => base44.entities.InventoryLocationSetting.list(),
    staleTime: 5 * MINUTE,
  });
}

export function useValueItems() {
  return useQuery({
    queryKey: inventoryKeys.valueItems,
    queryFn: () =>
      base44.entities.InventoryItem.list('-created_date', undefined, VALUE_ITEM_FIELDS),
    staleTime: MINUTE,
  });
}

export function useStockLevels() {
  return useQuery({
    queryKey: inventoryKeys.stockLevels,
    queryFn: () =>
      base44.entities.LocationInventory.list('-created_date', undefined, STOCK_LEVEL_FIELDS),
    staleTime: MINUTE,
  });
}

export function useRecentOrders(limit) {
  return useQuery({
    queryKey: inventoryKeys.recentOrders(limit),
    queryFn: () =>
      base44.entities.Order.list('-created_date', limit, ORDER_SUMMARY_FIELDS),
    staleTime: MINUTE,
  });
}

export function useRecentTransfers(limit) {
  return useQuery({
    queryKey: inventoryKeys.recentTransfers(limit),
    queryFn: () =>
      base44.entities.Transfer.list('-created_date', limit, ['id', 'status', 'created_date']),
    staleTime: MINUTE,
  });
}

export function usePendingInvoices() {
  return useQuery({
    queryKey: inventoryKeys.pendingInvoices,
    queryFn: () =>
      base44.entities.Invoice.filter({ status: 'pending_review' }, '-created_date', undefined, [
        'id',
        'status',
      ]),
    staleTime: MINUTE,
  });
}

export function usePrepaidPools() {
  return useQuery({
    queryKey: inventoryKeys.prepaidPools,
    queryFn: () => base44.entities.PrepaidPool.filter({ status: 'active' }),
    staleTime: MINUTE,
  });
}

export function useInventorySnapshots(snapshotDate) {
  return useQuery({
    queryKey: inventoryKeys.snapshotsByDate(snapshotDate),
    queryFn: () => base44.entities.InventorySnapshot.filter({ snapshot_date: snapshotDate }),
    enabled: Boolean(snapshotDate),
    staleTime: 5 * MINUTE,
  });
}
