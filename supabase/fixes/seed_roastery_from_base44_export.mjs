// Seeds roastery data from a Base44 "Roast & Source" JSON export.
//
// Usage:
//   node supabase/fixes/seed_roastery_from_base44_export.mjs <export.json> <company_id>
//
// Preserves original record ids so cross-entity references (green_coffee_id,
// category_slot_id, inventory_lot_id, ...) keep working. Upserts on id, so
// re-running is safe. Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
// .env.local (service role bypasses RLS). Set ENV_FILE to target another
// environment, e.g. ENV_FILE=.env.production.local for the production project.

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const [exportPath, companyId] = process.argv.slice(2);
if (!exportPath || !companyId) {
  console.error('Usage: node seed_roastery_from_base44_export.mjs <export.json> <company_id>');
  process.exit(1);
}

const envFile = path.resolve(process.cwd(), process.env.ENV_FILE || '.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()])
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Insert parents before children so references resolve as soon as each batch lands.
const ENTITY_TABLES = [
  ['GreenCoffee', 'roastery_green_coffees'],
  ['WarehouseLocation', 'roastery_warehouse_locations'],
  ['CategorySlot', 'roastery_category_slots'],
  ['Invoice', 'roastery_invoices'],
  ['InventoryLot', 'roastery_inventory_lots'],
  ['InventoryAdjustment', 'roastery_inventory_adjustments'],
  ['CategoryRotation', 'roastery_category_rotations'],
  ['BlendComponentRotation', 'roastery_blend_component_rotations'],
  ['PricingRecord', 'roastery_pricing_records'],
];

// Base44 metadata that has no column in the Supabase schema.
const DROP_FIELDS = new Set(['created_by', 'created_by_id', 'is_sample']);

// Fixed columns on roastery_pricing_records; everything else (bag_cost_*,
// calc_*, actual_*) is per-bag-size and lives in the jsonb "data" column.
const PRICING_RECORD_COLUMNS = new Set([
  'id', 'created_date', 'updated_date', 'company_id', 'green_coffee_id',
  'category_slot_id', 'green_cost_per_lb', 'weight_loss_pct',
  'target_margin_pct', 'target_retail_margin_pct', 'retail_markup_pct',
  'notes', 'effective_date', 'data',
]);

function toRow(entityName, record) {
  const row = {};
  const data = {};
  for (const [key, value] of Object.entries(record)) {
    if (DROP_FIELDS.has(key) || value === undefined) continue;
    if (entityName === 'PricingRecord' && !PRICING_RECORD_COLUMNS.has(key)) {
      data[key] = value;
      continue;
    }
    row[key] = value;
  }
  if (entityName === 'PricingRecord') row.data = { ...data, ...(record.data || {}) };
  row.company_id = companyId;
  return row;
}

const snapshot = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
if (!snapshot.data) {
  console.error('Invalid export file — missing data block.');
  process.exit(1);
}

const { data: company, error: companyError } = await supabase
  .from('companies').select('id, name').eq('id', companyId).maybeSingle();
if (companyError) throw companyError;
if (!company) {
  console.error(`No company found with id ${companyId}`);
  process.exit(1);
}
console.log(`Seeding into company: ${company.name} (${company.id})\n`);

let failed = false;
for (const [entityName, table] of ENTITY_TABLES) {
  const records = snapshot.data[entityName] || [];
  if (!records.length) {
    console.log(`${entityName}: nothing to import`);
    continue;
  }
  const rows = records.map((record) => toRow(entityName, record));
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
  if (error) {
    failed = true;
    console.error(`${entityName}: FAILED — ${error.message}`);
    continue;
  }
  console.log(`${entityName}: ${rows.length} records`);
}

process.exit(failed ? 1 : 0);
