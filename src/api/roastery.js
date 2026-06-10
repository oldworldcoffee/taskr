import { supabase } from '@/api/supabaseClient';
import { base44 } from '@/api/base44Client';

const ENTITY_TABLES = {
  Settings: 'roastery_settings',
  GreenCoffee: 'roastery_green_coffees',
  WarehouseLocation: 'roastery_warehouse_locations',
  Invoice: 'roastery_invoices',
  InventoryLot: 'roastery_inventory_lots',
  InventoryAdjustment: 'roastery_inventory_adjustments',
  CategorySlot: 'roastery_category_slots',
  CategoryRotation: 'roastery_category_rotations',
  BlendComponentRotation: 'roastery_blend_component_rotations',
  PricingRecord: 'roastery_pricing_records',
};

// PricingRecord carries dynamic per-bag-size fields (bag_cost_10oz,
// calc_wholesale_2lb, actual_retail_250g, ...). Bag sizes are configurable per
// company, so those keys live in a jsonb "data" column and get flattened into
// the record for page code.
const PRICING_RECORD_COLUMNS = new Set([
  'id',
  'created_date',
  'updated_date',
  'company_id',
  'green_coffee_id',
  'category_slot_id',
  'green_cost_per_lb',
  'weight_loss_pct',
  'target_margin_pct',
  'target_retail_margin_pct',
  'retail_markup_pct',
  'notes',
  'effective_date',
  'data',
]);

function flattenPricingRecord(row) {
  if (!row) return row;
  const { data, ...rest } = row;
  return { ...(data || {}), ...rest };
}

function foldPricingRecord(record = {}) {
  const columns = {};
  const data = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (PRICING_RECORD_COLUMNS.has(key)) {
      if (key === 'data') Object.assign(data, value || {});
      else columns[key] = value;
    } else {
      data[key] = value;
    }
  }
  return { ...columns, data };
}

function raise(error) {
  if (!error) return;
  const err = new Error(error.message || 'Request failed');
  err.status = error.status;
  err.details = error;
  throw err;
}

function applyFilters(query, filters = {}) {
  for (const [column, value] of Object.entries(filters || {})) {
    if (value === undefined) continue;
    if (value === null) {
      query = query.is(column, null);
      continue;
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      if ('$in' in value) {
        const values = value.$in || [];
        if (values.length === 0) return null;
        query = query.in(column, values);
      } else if ('$ne' in value) {
        query = query.neq(column, value.$ne);
      } else {
        query = query.eq(column, value);
      }
      continue;
    }

    query = query.eq(column, value);
  }

  return query;
}

function applySortAndLimit(query, sort, limit) {
  if (sort) {
    const descending = sort.startsWith('-');
    const column = descending ? sort.slice(1) : sort;
    query = query.order(column, { ascending: !descending });
  }

  if (limit) {
    query = query.limit(limit);
  }

  return query;
}

function sanitizeRecord(record = {}) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  );
}

function entityClient(entityName) {
  const table = ENTITY_TABLES[entityName];
  const isPricingRecord = entityName === 'PricingRecord';
  const fromRow = isPricingRecord ? flattenPricingRecord : (row) => row;
  const toRow = isPricingRecord
    ? (record) => foldPricingRecord(sanitizeRecord(record))
    : sanitizeRecord;

  return {
    async list(sort = '-created_date', limit) {
      const query = applySortAndLimit(supabase.from(table).select('*'), sort, limit);
      const { data, error } = await query;
      raise(error);
      return (data || []).map(fromRow);
    },

    async filter(filters = {}, sort = '-created_date', limit) {
      let query = applyFilters(supabase.from(table).select('*'), filters);
      if (!query) return [];
      query = applySortAndLimit(query, sort, limit);
      const { data, error } = await query;
      raise(error);
      return (data || []).map(fromRow);
    },

    async get(id) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('id', id)
        .maybeSingle();
      raise(error);
      return fromRow(data);
    },

    async create(record) {
      const { data, error } = await supabase
        .from(table)
        .insert(toRow(record))
        .select('*')
        .single();
      raise(error);
      return fromRow(data);
    },

    async update(id, record) {
      const payload = toRow(record);
      // Avoid wiping pricing data when an update doesn't touch dynamic fields.
      if (isPricingRecord && Object.keys(payload.data || {}).length === 0) {
        delete payload.data;
      }
      const { data, error } = await supabase
        .from(table)
        .update(payload)
        .eq('id', id)
        .select('*')
        .single();
      raise(error);
      return fromRow(data);
    },

    async delete(id) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      raise(error);
      return { id };
    },
  };
}

export const roastery = {
  entities: Object.fromEntries(
    Object.keys(ENTITY_TABLES).map((entityName) => [
      entityName,
      entityClient(entityName),
    ])
  ),

  functions: base44.functions,

  integrations: base44.integrations,
};
