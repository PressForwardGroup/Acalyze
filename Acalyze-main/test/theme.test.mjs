// Colour checks. Every var(--x) used anywhere must be defined, and the text/background
// pairs that matter must be readable (WCAG AA, 4.5:1) in BOTH the light and dark themes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const css = fs.readFileSync(path.join(root, 'public/css/app.css'), 'utf8');
const block = (re) => Object.fromEntries([...css.match(re)[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = block(/:root\{([\s\S]*?)\n\}/);
const dark = { ...light, ...block(/:root\[data-theme="dark"\]\{([\s\S]*?)\n\}/) };

const lum = (hex) => { const c = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('the palette from the brand is present', () => {
  assert.equal(light.navy.toLowerCase(), '#1a237e'); assert.equal(light.green.toLowerCase(), '#2e7d32'); assert.equal(light.gold.toLowerCase(), '#fbc02d');
  assert.ok(light.red && light.red.startsWith('#'));
});
test('every colour variable used in css and scripts is defined', () => {
  const used = new Set();
  const scan = (f) => { for (const m of fs.readFileSync(f, 'utf8').matchAll(/var\(--([\w-]+)/g)) used.add(m[1]); };
  scan(path.join(root, 'public/css/app.css'));
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(js|html)$/.test(e.name) && scan(path.join(d, e.name))));
  walk(path.join(root, 'public'));
  const missing = [...used].filter((v) => !(v in light));
  assert.deepEqual(missing, []);
});

const PAIRS = [
  ['ink', 'bg'], ['ink', 'surface'], ['mut', 'surface'], ['mut', 'bg'],
  ['on-green', 'green'], ['on-gold', 'gold'], ['on-red', 'red'], ['on-navy', 'navy'],
  ['ok', 'ok-bg'], ['warn', 'warn-bg'], ['bad', 'bad-bg'], ['info', 'info-bg'],
  ['ok', 'surface'], ['bad', 'surface'], ['info', 'surface'], ['gold-ink', 'surface'],
];
for (const [name, theme] of [['light', light], ['dark', dark]]) {
  test(`${name} theme: key text/background pairs are readable (4.5:1)`, () => {
    const bad = PAIRS.filter(([a, b]) => ratio(theme[a], theme[b]) < 4.5).map(([a, b]) => `${a} on ${b} = ${ratio(theme[a], theme[b]).toFixed(2)}`);
    assert.deepEqual(bad, []);
  });
}
test('white text on the navy and on the navy2 gradient end is readable', () => {
  assert.ok(ratio('#FFFFFF', light.navy2) >= 4.5 && ratio('#FFFFFF', dark.navy2) >= 4.5);
});
test('the dark-theme chart colours stand out against the dark surface', () => {
  const weak = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].filter((k) => ratio(dark[k], dark.surface) < 3);
  assert.deepEqual(weak, []);
});
test('chart colours are distinct from each other (no two the same)', () => {
  for (const t of [light, dark]) assert.equal(new Set(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((k) => t[k].toLowerCase())).size, 6);
});
