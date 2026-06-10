// Mirrors Base44-hosted roastery files (green coffee photos, invoice PDFs)
// into the Supabase storage bucket and retargets the stored URLs.
//
// Usage:
//   node supabase/fixes/migrate_roastery_files_from_base44.mjs <company_id>
//
// Idempotent: uploads use upsert, and records whose URLs no longer point at
// base44 are skipped. Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
// .env.local. Set ENV_FILE to target another environment, e.g.
// ENV_FILE=.env.production.local for the production project.

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const [companyId] = process.argv.slice(2);
if (!companyId) {
  console.error('Usage: node migrate_roastery_files_from_base44.mjs <company_id>');
  process.exit(1);
}

const envFile = path.resolve(process.cwd(), process.env.ENV_FILE || '.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()])
);

const BUCKET = env.VITE_SUPABASE_STORAGE_BUCKET || 'taskr-uploads';
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
if (bucketsError) throw bucketsError;
if (!buckets.some((bucket) => bucket.name === BUCKET)) {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (error) throw new Error(`creating bucket "${BUCKET}" failed: ${error.message}`);
  console.log(`Created public bucket "${BUCKET}".`);
}

const isBase44Url = (url) => typeof url === 'string' && url.includes('base44');

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
};

async function mirrorFile(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`download failed (${response.status})`);
  const body = Buffer.from(await response.arrayBuffer());

  // Base44 filenames already carry a content-hash prefix, so the last path
  // segment is unique and safe to reuse as the object name.
  const fileName = decodeURIComponent(new URL(url).pathname.split('/').pop());
  const objectPath = `roastery-migration/${companyId}/${fileName}`;
  const contentType =
    response.headers.get('content-type')?.split(';')[0] ||
    CONTENT_TYPES[path.extname(fileName).toLowerCase()] ||
    'application/octet-stream';

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, body, { contentType, upsert: true });
  if (error) throw new Error(`upload failed: ${error.message}`);

  return supabase.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

// --- Collect every Base44 URL referenced by this company's records ---

const { data: coffees, error: coffeesError } = await supabase
  .from('roastery_green_coffees')
  .select('id, name, photos')
  .eq('company_id', companyId);
if (coffeesError) throw coffeesError;

const { data: invoices, error: invoicesError } = await supabase
  .from('roastery_invoices')
  .select('id, file_name, file_url')
  .eq('company_id', companyId);
if (invoicesError) throw invoicesError;

const urls = new Set();
for (const coffee of coffees) {
  for (const photo of coffee.photos || []) if (isBase44Url(photo)) urls.add(photo);
}
for (const invoice of invoices) {
  if (isBase44Url(invoice.file_url)) urls.add(invoice.file_url);
}

console.log(`Found ${urls.size} Base44-hosted files to mirror into "${BUCKET}".`);

// --- Mirror files with limited concurrency ---

const urlMap = new Map(); // old base44 url -> new supabase public url
const failures = [];
const queue = [...urls];
let done = 0;

await Promise.all(
  Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const url = queue.pop();
      try {
        urlMap.set(url, await mirrorFile(url));
      } catch (err) {
        failures.push({ url, error: err.message });
      }
      done++;
      if (done % 25 === 0 || done === urls.size) {
        console.log(`  mirrored ${done}/${urls.size} (${failures.length} failed)`);
      }
    }
  })
);

for (const { url, error } of failures) console.error(`FAILED: ${url} — ${error}`);

// --- Retarget record URLs (only those successfully mirrored) ---

let coffeesUpdated = 0;
for (const coffee of coffees) {
  const photos = (coffee.photos || []).map((photo) => urlMap.get(photo) || photo);
  if (JSON.stringify(photos) === JSON.stringify(coffee.photos)) continue;
  const { error } = await supabase
    .from('roastery_green_coffees')
    .update({ photos })
    .eq('id', coffee.id);
  if (error) {
    failures.push({ url: `coffee ${coffee.id}`, error: error.message });
    console.error(`FAILED to update coffee ${coffee.name}: ${error.message}`);
    continue;
  }
  coffeesUpdated++;
}

let invoicesUpdated = 0;
for (const invoice of invoices) {
  const newUrl = urlMap.get(invoice.file_url);
  if (!newUrl) continue;
  const { error } = await supabase
    .from('roastery_invoices')
    .update({ file_url: newUrl })
    .eq('id', invoice.id);
  if (error) {
    failures.push({ url: `invoice ${invoice.id}`, error: error.message });
    console.error(`FAILED to update invoice ${invoice.file_name}: ${error.message}`);
    continue;
  }
  invoicesUpdated++;
}

console.log(`\nMirrored ${urlMap.size}/${urls.size} files.`);
console.log(`Updated ${coffeesUpdated} green coffees and ${invoicesUpdated} invoices.`);
process.exit(failures.length ? 1 : 0);
