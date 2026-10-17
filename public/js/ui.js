// Small UI toolkit: escaping, formatting, toasts, modals, theme, and the SVG
// charts. Chart functions are pure (they return strings) so they're testable
// without a browser. Colours come from CSS variables, so charts follow the theme.

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const num = (n, d = 1) => (n == null || Number.isNaN(+n) ? '—' : (+n).toFixed(d).replace(/\.0+$/, ''));
export const kes = (n) => (n == null ? '—' : 'KSh ' + Math.round(+n).toLocaleString('en-KE'));
// "2026-10-16" (a calendar date, no time) is shown as that exact day in any timezone; real timestamps use the viewer's local time.
export const fmtDate = (d) => {
  if (!d) return '—';
  const m = typeof d === 'string' && d.length === 10 && d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return (m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// ---------- theme ----------
export const theme = {
  init() {
    const saved = localStorage.getItem('acalyze.theme');
    const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  },
  toggle() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('acalyze.theme', next);
    return next;
  },
  isDark: () => document.documentElement.dataset.theme === 'dark',
};

// ---------- toast & modal ----------
export function toast(msg, kind = '') {
  let wrap = $('.toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; wrap.setAttribute('role', 'status'); document.body.append(wrap); }
  const t = document.createElement('div'); t.className = `toast ${kind}`; t.textContent = msg; wrap.append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 6500 : 3800);
}
export function modal(html, { onMount } = {}) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
  document.body.append(bg); onMount?.(bg.firstElementChild, close);
  return { el: bg.firstElementChild, close };
}
export async function confirmBox(message, okLabel = 'Confirm') {
  return new Promise((res) => {
    const m = modal(`<h3>${esc(message)}</h3><div class="row" style="margin-top:18px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div>`);
    m.el.querySelector('[data-ok]').onclick = () => { m.close(); res(true); };
    m.el.parentElement.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === m.el.parentElement) res(false); });
  });
}
export async function run(btn, fn) {          // disable a button while an async action runs
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, 'bad'); } finally { if (btn) btn.disabled = false; }
}
export function copy(text) { navigator.clipboard?.writeText(text).then(() => toast('Copied', 'ok')); }

// ---------- charts (pure SVG strings) ----------
const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
export const color = (i) => COLORS[i % COLORS.length];
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

// Vertical bars. items: [{label, value, color?}]
export function barChart(items, { height = 200, max, unit = '', title = 'Bar chart' } = {}) {
  if (!items.length) return '<div class="empty">No data yet</div>';
  const W = Math.max(320, items.length * 58), H = height, padB = 34, padT = 20;
  const m = max ?? Math.max(1, ...items.map((i) => +i.value || 0));
  const bw = Math.min(36, (W / items.length) * 0.6);
  const bars = items.map((it, i) => {
    const v = +it.value || 0, h = Math.max(0, ((H - padB - padT) * v) / m);
    const x = (W / items.length) * (i + 0.5) - bw / 2, y = H - padB - h;
    return `<g><rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="4" fill="${it.color || color(0)}"><title>${esc(it.label)}: ${num(v)}${unit}</title></rect>
      <text class="val" x="${x + bw / 2}" y="${y - 5}" text-anchor="middle">${num(v)}${unit}</text>
      <text x="${x + bw / 2}" y="${H - 14}" text-anchor="middle">${esc(clip(it.label, 9))}</text></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}"><line x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}" stroke="var(--line)"/>${bars}</svg>`;
}

// Horizontal bars (good for long names). items: [{label, value}]
export function hbarChart(items, { max, unit = '', title = 'Bar chart', colorFn } = {}) {
  if (!items.length) return '<div class="empty">No data yet</div>';
  const rowH = 30, W = 520, labelW = 140, H = items.length * rowH + 6;
  const m = max ?? Math.max(1, ...items.map((i) => +i.value || 0));
  const rows = items.map((it, i) => {
    const v = +it.value || 0, w = ((W - labelW - 56) * v) / m, y = i * rowH + 4;
    return `<g><text x="0" y="${y + 17}">${esc(clip(it.label, 20))}</text>
      <rect x="${labelW}" y="${y + 4}" width="${Math.max(2, w)}" height="16" rx="4" fill="${colorFn ? colorFn(it, i) : color(0)}"><title>${esc(it.label)}: ${num(v)}${unit}</title></rect>
      <text class="val" x="${labelW + Math.max(2, w) + 6}" y="${y + 17}">${num(v)}${unit}</text></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${rows}</svg>`;
}

// Lines. series: [{name, values:[...]}], labels: x labels
export function lineChart(labels, series, { height = 210, unit = '', title = 'Line chart', min, max } = {}) {
  if (!labels.length) return '<div class="empty">No data yet</div>';
  const W = Math.max(360, labels.length * 80), H = height, pad = { l: 34, r: 16, t: 16, b: 30 };
  const all = series.flatMap((s) => s.values.filter((v) => v != null));
  const lo = min ?? Math.min(0, ...all), hi = max ?? Math.max(1, ...all) * 1.08;
  const X = (i) => pad.l + ((W - pad.l - pad.r) * (labels.length === 1 ? 0.5 : i / (labels.length - 1)));
  const Y = (v) => H - pad.b - ((H - pad.t - pad.b) * (v - lo)) / (hi - lo || 1);
  const ticks = [0, 0.5, 1].map((t) => lo + (hi - lo) * t);
  const grid = ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line2)"/><text x="${pad.l - 6}" y="${Y(t) + 4}" text-anchor="end">${num(t, 0)}</text>`).join('');
  const lines = series.map((s, si) => {
    const pts = s.values.map((v, i) => (v == null ? null : [X(i), Y(v), v])).filter(Boolean);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${color(si)}" stroke-width="2.5" stroke-linejoin="round"/>` +
      pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="var(--surface)" stroke="${color(si)}" stroke-width="2"><title>${esc(s.name)}: ${num(p[2])}${unit}</title></circle>`).join('');
  }).join('');
  const xl = labels.map((l, i) => `<text x="${X(i)}" y="${H - 8}" text-anchor="middle">${esc(clip(l, 12))}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}${lines}${xl}</svg>`;
}

// Donut. parts: [{label, value}]
export function donut(parts, { size = 170, title = 'Breakdown', center } = {}) {
  const total = parts.reduce((a, p) => a + (+p.value || 0), 0);
  if (!total) return '<div class="empty">No data yet</div>';
  const r = 60, c = 2 * Math.PI * r; let off = 0;
  const arcs = parts.map((p, i) => {
    const len = (c * (+p.value || 0)) / total;
    const s = `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${color(i)}" stroke-width="22" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 80 80)"><title>${esc(p.label)}: ${p.value}</title></circle>`;
    off += len; return s;
  }).join('');
  const legend = parts.map((p, i) => `<span><i style="background:${color(i)}"></i>${esc(p.label)} (${p.value})</span>`).join('');
  return `<div class="row" style="gap:20px"><svg viewBox="0 0 160 160" width="${size}" height="${size}" role="img" aria-label="${esc(title)}">${arcs}
    <text x="80" y="78" text-anchor="middle" class="val" style="font-size:22px;font-family:var(--serif)">${esc(center ?? total)}</text>
    <text x="80" y="95" text-anchor="middle">total</text></svg><div class="legend" style="flex-direction:column;gap:6px">${legend}</div></div>`;
}

export const progress = (pct) => `<div class="bar" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;
export const pill = (text, kind = '') => `<span class="pill ${kind}">${esc(text)}</span>`;
export const stat = (label, value, { accent, sub, tone } = {}) => `<div class="card stat ${tone ? 'tone-' + tone : accent ? 'tone-red' : ''}"><span class="l">${esc(label)}</span><span class="n">${esc(value)}</span>${sub ? `<span class="sm mut">${esc(sub)}</span>` : ''}</div>`;
export const table = (heads, rows, { empty = 'Nothing here yet.' } = {}) => rows.length
  ? `<div class="ov"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  : `<div class="empty">${esc(empty)}</div>`;
