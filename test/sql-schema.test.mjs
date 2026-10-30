// Every table and column named in every SQL query must exist in db/schema.sql.
// There is no database in CI, so this is the guard against typos and against
// queries that still reference a column that was renamed or removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const schema = fs.readFileSync(path.join(root, 'db/schema.sql'), 'utf8').replace(/--[^\n]*/g, '');
const tables = {};
for (const m of schema.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)) {
  tables[m[1]] = new Set(m[2].split('\n').map((l) => l.trim().match(/^(\w+)\s+(uuid|text|int|boolean|numeric|date|timestamptz|jsonb|section|grading_scheme|org_status|report_card_template|billing_cycle|edit_request_type|edit_request_status)\b/)?.[1]).filter((c) => c && !['PRIMARY', 'UNIQUE', 'CONSTRAINT', 'CHECK', 'FOREIGN'].includes(c)));
}
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
const queries = [];
for (const f of walk(path.join(root, 'src')))
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/`([^`]*)`/g))
    if (/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/.test(m[1]) && /\b(FROM|INTO|UPDATE|SET)\b/.test(m[1])) queries.push([path.relative(root, f), m[1].replace(/\$\{[^}]*\}/g, 'X').replace(/\s+/g, ' ')]);

test('schema parsed', () => assert.ok(Object.keys(tables).length >= 20 && queries.length > 100));
test('every table and column used in a query exists in the schema', () => {
  const KW = new Set(['WHERE', 'ON', 'SET', 'LEFT', 'RIGHT', 'INNER', 'JOIN', 'GROUP', 'ORDER', 'LIMIT', 'AND', 'OR', 'VALUES', 'RETURNING', 'USING', 'UNION', 'SELECT', 'FROM', 'AS', 'CROSS', 'HAVING', 'FILTER', 'DO', 'NOT', 'IN', 'IS']);
  const problems = [];
  for (const [file, q] of queries) {
    const alias = {};
    for (const m of q.matchAll(/\b(?:FROM|JOIN|(?<!DO )UPDATE|INTO)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi)) {
      const [, t, a] = m;
      if (['select', 'unnest', 'X', 'current_date', 'now'].includes(t)) continue;   // not tables: extract(... FROM current_date)
      if (!tables[t]) { problems.push(`${file}: unknown table "${t}"`); continue; }
      alias[t] = t; if (a && !KW.has(a.toUpperCase())) alias[a] = t;
    }
    for (const m of q.matchAll(/\b([a-z_]{1,12})\.([a-z_]+)\b/g)) if (alias[m[1]] && !tables[alias[m[1]]].has(m[2])) problems.push(`${file}: "${m[1]}.${m[2]}" is not a column of ${alias[m[1]]}`);
    for (const m of q.matchAll(/INSERT INTO (\w+) \(([^)]*)\)/g)) if (tables[m[1]]) for (const c of m[2].split(',').map((x) => x.trim())) if (c && !tables[m[1]].has(c)) problems.push(`${file}: INSERT column "${c}" is not in ${m[1]}`);
    for (const m of q.matchAll(/(?<!DO )UPDATE (\w+) SET (.*?)(?: WHERE|$)/g)) if (tables[m[1]]) for (const c of [...m[2].matchAll(/(?:^|,)\s*(\w+)\s*=/g)].map((x) => x[1])) if (!tables[m[1]].has(c)) problems.push(`${file}: UPDATE column "${c}" is not in ${m[1]}`);
  }
  assert.deepEqual([...new Set(problems)], []);
});
test('every foreign key points at a table defined EARLIER in schema.sql (so a fresh database builds)', () => {
  const order = [...schema.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]);
  const bad = [];
  for (const m of schema.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)) for (const r of m[2].matchAll(/REFERENCES (\w+)\(/g)) if (order.indexOf(r[1]) === -1 || order.indexOf(r[1]) > order.indexOf(m[1])) bad.push(`${m[1]} -> ${r[1]}`);
  assert.deepEqual(bad, []);
});
