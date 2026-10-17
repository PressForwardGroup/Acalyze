// The browser can't be run in CI, so these tests check the wiring statically:
//  1. every navigation item has a view, for every role,
//  2. every frontend module loads (imports resolve, exports exist),
//  3. every API call the frontend makes matches a real route (method + path) on the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = globalThis.localStorage;
const root = new URL('..', import.meta.url).pathname;
const views = path.join(root, 'public/js/views');
const MODS = { platform_admin: 'platform.js', admin: 'admin.js', teacher: 'teacher.js', parent: 'parent.js' };

test('every frontend module loads', async () => {
  for (const f of fs.readdirSync(views).filter((x) => x.endsWith('.js'))) await import(path.join(views, f));
});
test('every navigation item has a view, for every role', async () => {
  const src = fs.readFileSync(path.join(views, 'shell.js'), 'utf8');
  const NAV = new Function('return ' + src.match(/const NAV = (\{[\s\S]*?\n\});/)[1])();
  for (const [role, items] of Object.entries(NAV)) {
    const m = await import(path.join(views, MODS[role]));
    const missing = items.map((i) => i[0]).filter((k) => k !== 'sec' && typeof m.views[k] !== 'function');
    assert.deepEqual(missing, [], `${role} nav items without a view`);
  }
});

// ---- API calls vs server routes ----
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
const serverSrc = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
const mounts = Object.fromEntries([...serverSrc.matchAll(/app\.use\('([^']+)',\s*(?:[\w()'., :{}]*,\s*)?(\w+Router)\)/g)].map((m) => [m[2], m[1]]));
const routes = [];
for (const f of walk(path.join(root, 'src/routes'))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(\w+Router)\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
    const prefix = mounts[m[1]]; if (prefix === undefined) continue;
    const full = (prefix + (m[3] === '/' ? '' : m[3])).replace(/:\w+/g, '[^/]+');
    routes.push({ method: m[2].toUpperCase(), re: new RegExp(`^${full}$`), src: `${m[2].toUpperCase()} ${prefix}${m[3] === '/' ? '' : m[3]}` });
  }
}
function calls() {
  const out = [];
  for (const f of walk(path.join(root, 'public/js'))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bapi\(\s*([`'])(\/[^`']*)\1/g)) {
      // the matching close paren, to find this call's `method:` option
      let depth = 1, i = m.index + m[0].length, q = null;
      for (; i < src.length && depth; i++) { const c = src[i]; if (q) { if (c === q && src[i - 1] !== '\\') q = null; } else if ('\'"`'.includes(c)) q = c; else if (c === '(') depth++; else if (c === ')') depth--; }
      const rest = src.slice(m.index + m[0].length, i);
      const method = (rest.match(/method:\s*'(GET|POST|PUT|PATCH|DELETE)'/) || [, 'GET'])[1];
      let p = m[2].replace(/\$\{[^}]*$/, '').split('?')[0];   // a nested template (`${a ? `?x=1` : ''}`) is cut at its start
      p = p.replace(/(\/?)\$\{[^}]*\}/g, (all, slash) => (slash ? '/:p' : '')).replace(/\/+$/, '') || '/';
      out.push({ method, path: p, file: path.relative(root, f), raw: m[2] });
    }
  }
  return out;
}
test('the frontend makes a meaningful number of API calls (the extractor is working)', () => { assert.ok(calls().length > 100, `found ${calls().length}`); assert.ok(routes.length > 100, `found ${routes.length} routes`); });
test('every API call in the frontend matches a route on the server', () => {
  const bad = calls().filter((c) => !routes.some((r) => r.method === c.method && r.re.test(c.path))).map((c) => `${c.method} ${c.raw}  (${c.file})`);
  assert.deepEqual([...new Set(bad)], []);
});
