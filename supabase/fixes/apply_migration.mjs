// Apply a SQL migration file to a Supabase Postgres database over a direct
// connection (DDL — which the service-role/PostgREST key cannot do).
//
// Reads DEV_DATABASE_URL (or DATABASE_URL) from .env.local by default. Point at
// another env file with ENV_FILE=, e.g.:
//   ENV_FILE=.env.production.local node supabase/fixes/apply_migration.mjs <file.sql>
//
// Runs the whole file inside a single transaction so a partial failure rolls back.

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const migrationArg = process.argv[2];
if (!migrationArg) {
  console.error('Usage: node supabase/fixes/apply_migration.mjs <path-to-migration.sql>');
  process.exit(1);
}

const envFile = path.resolve(process.cwd(), process.env.ENV_FILE || '.env.local');
const env = {};
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) continue;
  let [, key, value] = match;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  env[key] = value;
}

const connectionString = env.DEV_DATABASE_URL || env.DATABASE_URL;
if (!connectionString) {
  console.error(`Missing DEV_DATABASE_URL (or DATABASE_URL) in ${envFile}`);
  process.exit(1);
}

const sqlPath = path.resolve(process.cwd(), migrationArg);
const sql = fs.readFileSync(sqlPath, 'utf8');

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log(`Connected. Applying ${path.basename(sqlPath)} ...`);
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('✓ Migration applied successfully.');
} catch (error) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error('✗ Migration failed (rolled back):', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
