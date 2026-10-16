// Cross-platform test entry (Windows' npm doesn't expand "*" globs).
// Runs every test/*.test.mjs with the database stand-in loaded.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(dir, f));
const r = spawnSync(process.execPath, ['--import', path.join(dir, 'register.mjs'), '--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
