import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listMigrations, applyMigrations } from '../src/lib/migrations.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
const put = (d, n, sql = 'SELECT 1;') => fs.writeFileSync(path.join(d, n), sql);

test('lists migrations in version order and ignores non-sql files', () => {
  const d = tmp(); put(d, '010_later.sql'); put(d, '002_first.sql'); put(d, 'README.md');
  assert.deepEqual(listMigrations(d).map((m) => m.version), [2, 10]);
});
test('rejects bad names, version 1 and duplicate versions', () => {
  let d = tmp(); put(d, 'add_stuff.sql'); assert.throws(() => listMigrations(d), /must be named/);
  d = tmp(); put(d, '001_baseline.sql'); assert.throws(() => listMigrations(d), /Start at 002/);
  d = tmp(); put(d, '002_a.sql'); put(d, '002_b.sql'); assert.throws(() => listMigrations(d), /share version 2/);
});
test('a missing folder means no migrations', () => assert.deepEqual(listMigrations('/no/such/dir'), []));

// A tiny fake pool that records what ran, to test ordering, skipping and rollback.
function fakePool({ already = [], failOn = null } = {}) {
  const log = [], recorded = new Set(already);
  const run = async (sql, params) => {
    log.push(sql.trim().split('\n')[0].slice(0, 40));
    if (/SELECT version FROM schema_migrations/.test(sql)) return { rows: [...recorded].map((version) => ({ version })) };
    if (/INSERT INTO schema_migrations/.test(sql) && params) recorded.add(params[0]);
    if (failOn && sql.includes(failOn)) throw new Error('boom');
    return { rows: [] };
  };
  return { log, recorded, query: run, connect: async () => ({ query: run, release() {} }) };
}
test('applies only the migrations not yet recorded, in order', async () => {
  const d = tmp(); put(d, '002_a.sql', '-- a'); put(d, '003_b.sql', '-- b'); put(d, '004_c.sql', '-- c');
  const p = fakePool({ already: [1, 2] });
  const n = await applyMigrations(p, d, () => {});
  assert.equal(n, 2); assert.deepEqual([...p.recorded].sort(), [1, 2, 3, 4]);
});
test('a failing migration is rolled back, not recorded, and stops startup', async () => {
  const d = tmp(); put(d, '002_ok.sql', '-- ok'); put(d, '003_bad.sql', 'EXPLODE;');
  const p = fakePool({ failOn: 'EXPLODE' });
  await assert.rejects(() => applyMigrations(p, d, () => {}), /003_bad failed and was rolled back/);
  assert.ok(p.recorded.has(2) && !p.recorded.has(3)); assert.ok(p.log.includes('ROLLBACK'));
});
