// Seed the Financial Management module from a base44 "square-link-pro" export.
//
// Maps the export's base44 locations onto taskr locations (by name, within the
// target company) and stamps their square_location_id, then loads labor settings,
// schedules, and shifts into the financial_* tables scoped to the target company.
// tenant_members are intentionally ignored (taskr roles replace them).
//
// Idempotent: clears the target company's financial_labor_settings / schedules /
// shifts before inserting, so re-running gives a clean reseed.
//
// Usage:
//   COMPANY_ID=<taskr company id> \
//   node supabase/fixes/seed_financial_from_export.mjs <export.json>
//
// Target a different environment with ENV_FILE (reads SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY from it; service role bypasses RLS):
//   ENV_FILE=.env.production.local COMPANY_ID=<prod company id> \
//   node supabase/fixes/seed_financial_from_export.mjs <export.json>

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const exportArg = process.argv[2];
if (!exportArg) {
  console.error('Usage: [COMPANY_ID=...] node supabase/fixes/seed_financial_from_export.mjs <export.json>');
  process.exit(1);
}

const companyId = process.env.COMPANY_ID;
if (!companyId) {
  console.error('Set COMPANY_ID to the taskr company to seed into.');
  process.exit(1);
}

const envFile = path.resolve(process.cwd(), process.env.ENV_FILE || '.env.local');
const env = {};
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const norm = (s) => String(s || '').trim().toLowerCase();
const exportData = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), exportArg), 'utf8')).data;

console.log(`Target: ${env.SUPABASE_URL}`);
console.log(`Company: ${companyId}`);

// 1. Map base44 locations -> taskr locations (by name within the company).
const { data: taskrLocations, error: locErr } = await sb
  .from('locations')
  .select('id,name,square_location_id')
  .eq('company_id', companyId);
if (locErr) throw locErr;

const taskrByName = new Map(taskrLocations.map((l) => [norm(l.name), l]));
const locMap = new Map(); // base44 location id -> taskr location id
const unmatched = [];
for (const loc of exportData.locations || []) {
  const match = taskrByName.get(norm(loc.name));
  if (match) {
    locMap.set(loc.id, match.id);
    // Stamp the Square location id so a later Square connect links cleanly.
    if (loc.square_location_id && match.square_location_id !== loc.square_location_id) {
      const { error } = await sb
        .from('locations')
        .update({ square_location_id: loc.square_location_id })
        .eq('id', match.id);
      if (error) throw error;
    }
  } else {
    unmatched.push(loc.name);
  }
}
console.log(`\nLocations: ${locMap.size} matched, ${unmatched.length} unmatched${unmatched.length ? ` (skipped: ${unmatched.join(', ')})` : ''}`);

// 2. Clear existing financial data for this company (idempotent reseed).
for (const table of ['financial_shifts', 'financial_schedules', 'financial_labor_settings']) {
  const { error } = await sb.from(table).delete().eq('company_id', companyId);
  if (error) throw error;
}

// 3. Labor settings.
const laborRows = [];
let laborSkipped = 0;
for (const ls of exportData.labor_settings || []) {
  const locId = locMap.get(ls.location_id);
  if (!locId) { laborSkipped++; continue; }
  laborRows.push({
    company_id: companyId,
    location_id: locId,
    labor_cost_mode: ls.labor_cost_mode ?? 'simplified',
    hourly_rate: ls.hourly_rate ?? null,
    target_labor_pct: ls.target_labor_pct ?? null,
    floor_hourly_rate: ls.floor_hourly_rate ?? null,
    tax_percentage: ls.tax_percentage ?? null,
    benefits_percentage: ls.benefits_percentage ?? null,
    manager_compensation: ls.manager_compensation ?? null,
    manager_hours_allocated: ls.manager_hours_allocated ?? null,
    labor_cost_offset: ls.labor_cost_offset ?? null,
    yearly_sales_offset_pct: ls.yearly_sales_offset_pct ?? null,
    operating_hours: ls.operating_hours ?? {},
  });
}
if (laborRows.length) {
  const { error } = await sb.from('financial_labor_settings').insert(laborRows);
  if (error) throw error;
}
console.log(`Labor settings: ${laborRows.length} inserted${laborSkipped ? `, ${laborSkipped} skipped (unmapped location)` : ''}`);

// 4. Schedules — insert and capture base44 id -> new id map.
const schedMap = new Map();
let schedSkipped = 0;
for (const sc of exportData.schedules || []) {
  const locId = locMap.get(sc.location_id);
  if (!locId) { schedSkipped++; continue; }
  const { data, error } = await sb
    .from('financial_schedules')
    .insert({
      company_id: companyId,
      location_id: locId,
      week_start_date: sc.week_start_date ?? null,
      status: sc.status ?? 'draft',
      is_template: sc.is_template ?? false,
      template_effective_from: sc.template_effective_from ?? null,
      notes: sc.notes ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  schedMap.set(sc.id, data.id);
}
console.log(`Schedules: ${schedMap.size} inserted${schedSkipped ? `, ${schedSkipped} skipped (unmapped location)` : ''}`);

// 5. Shifts — remap schedule_id + location_id.
const shiftRows = [];
let shiftSkipped = 0;
for (const sh of exportData.shifts || []) {
  const schedId = schedMap.get(sh.schedule_id);
  const locId = locMap.get(sh.location_id);
  if (!schedId || !locId) { shiftSkipped++; continue; }
  shiftRows.push({
    company_id: companyId,
    schedule_id: schedId,
    location_id: locId,
    employee_name: sh.employee_name ?? null,
    day_of_week: sh.day_of_week ?? null,
    start_time: sh.start_time ?? null,
    end_time: sh.end_time ?? null,
    hourly_rate: sh.hourly_rate ?? null,
    notes: sh.notes ?? null,
    display_order: sh.display_order ?? 0,
  });
}
if (shiftRows.length) {
  const { error } = await sb.from('financial_shifts').insert(shiftRows);
  if (error) throw error;
}
console.log(`Shifts: ${shiftRows.length} inserted${shiftSkipped ? `, ${shiftSkipped} skipped (unmapped schedule/location)` : ''}`);

console.log('\n✓ Seed complete.');
