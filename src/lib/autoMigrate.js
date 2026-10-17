import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';
import { seed } from '../scripts/seed.js';
import { applyMigrations } from './migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Runs on every boot; everything here is safe to repeat.
// A FRESH database gets db/schema.sql (version 1); later changes ship as numbered
// files in db/migrations and are applied automatically, once, in order.
// A FRESH database gets db/schema.sql. This schema is not compatible with the
// old MOHI one, so an existing MOHI database must not be pointed at Acalyze.
export async function ensureSchema() {
  const { rows } = await pool.query(`SELECT to_regclass('public.organizations') AS orgs, to_regclass('public.centers') AS old_centers`);
  if (!rows[0].orgs) {
    if (rows[0].old_centers) {
      throw new Error('This database holds an old MOHI schema. Point Acalyze at a new, empty database.');
    }
    console.log('[startup] No schema found, applying db/schema.sql...');
    await pool.query(fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8'));
    console.log('[startup] Schema applied.');
  }
  // Bring an existing database up to date with any newer migrations.
  const applied = await applyMigrations(pool, path.join(__dirname, '..', '..', 'db', 'migrations'));
  if (applied) console.log(`[startup] ${applied} migration(s) applied.`);

  const { rows: n } = await pool.query(`SELECT count(*)::int AS n FROM platform_admins`);
  if (n[0].n === 0) {
    console.log('[startup] No platform admin yet, running seed...');
    await seed();
  } else {
    console.log(`[startup] ${n[0].n} platform admin(s) found, skipping seed.`);
  }
}
