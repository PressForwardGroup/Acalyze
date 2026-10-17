import fs from 'fs';
import path from 'path';

// Migration files live in db/migrations and are named NNN_short_name.sql
// (e.g. 002_add_fee_discounts.sql). Version 1 is db/schema.sql itself, the
// baseline; anything numbered 2 or higher is applied once, in order, on boot.
const NAME = /^(\d{3,})_([a-z0-9_]+)\.sql$/;

export function listMigrations(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.sql')) continue;
    const m = file.match(NAME);
    if (!m) throw new Error(`Migration "${file}" must be named like 002_short_name.sql (lowercase, digits and underscores).`);
    const version = parseInt(m[1], 10);
    if (version < 2) throw new Error(`Migration "${file}": version 1 is db/schema.sql. Start at 002.`);
    if (out.some((x) => x.version === version)) throw new Error(`Two migrations share version ${version}.`);
    out.push({ version, name: m[2], file: path.join(dir, file) });
  }
  return out.sort((a, b) => a.version - b.version);
}

// Applies every migration not yet recorded, each in its own transaction, so a
// failing migration changes nothing and stops the app from starting half-updated.
export async function applyMigrations(pool, dir, log = console.log) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version int PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  await pool.query(`INSERT INTO schema_migrations (version, name) VALUES (1, 'baseline') ON CONFLICT DO NOTHING`);
  const done = new Set((await pool.query(`SELECT version FROM schema_migrations`)).rows.map((r) => r.version));
  let applied = 0;
  for (const m of listMigrations(dir)) {
    if (done.has(m.version)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(m.file, 'utf8'));
      await client.query(`INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`, [m.version, m.name]);
      await client.query('COMMIT');
      log(`[startup] Applied migration ${String(m.version).padStart(3, '0')}_${m.name}`);
      applied++;
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${String(m.version).padStart(3, '0')}_${m.name} failed and was rolled back: ${err.message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}
