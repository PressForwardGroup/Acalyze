import { esc, recent, BAND_LABELS, band } from '../ui.js';

// Pieces shared by the Home screens of the principal and the finance officer.
export const hello = (me, fallback = 'there') => {
  const hr = new Date().getHours(), first = (me.name || '').split(' ')[0] || fallback;
  return `Good ${hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening'}, ${first}`;
};
export const dateLine = (me) => `${me.organization || 'Your school'} · ${new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' })}`;

// A count of things waiting: none is excellent, a few is "monitor", many is "at risk".
export const countTone = (n) => (n === 0 ? 'b5' : n <= 4 ? 'b3' : 'b2');
export const countSub = (n) => (n === 0 ? 'All clear' : n <= 4 ? 'Needs monitoring' : 'At risk');
export const bandSub = (pct, extra = '') => (band(pct) ? `${BAND_LABELS[band(pct)]}${extra ? ' · ' + extra : ''}` : extra);

export const waitingBar = (text, href, label = 'Review now') =>
  `<div class="note-bar fade"><b>${esc(text)}</b><span class="grow"></span><a class="btn sm primary" href="${href}">${esc(label)}</a></div>`;

// [icon, title, sub, page, count] -> a row of tiles
export const tiles = (list) => list.length ? `<h2 class="sect">Do today</h2><div class="tiles fade">${list.map(([ic, t, sub, k, n]) =>
  `<a class="tile" href="#/app/${k}"><span class="ti">${ic}</span><span class="grow"><b>${esc(t)}</b><span class="sm mut">${esc(sub)}</span></span>${n ? `<span class="badge">${n}</span>` : ''}<span class="mut">›</span></a>`).join('')}</div>` : '';

// The reports this person opened lately (kept in this browser), with sensible defaults when there are none yet.
export const reports = (names, defaults) => {
  const keys = recent.list().filter((k) => names[k]), show = (keys.length ? keys : defaults).slice(0, 5);
  return `<h2 class="sect">Your reports</h2><div class="card pad0 fade">${show.map((k) => `<a class="rep" href="#/app/${k}"><span><span class="star">★</span> ${esc(names[k])}</span><span class="mut">›</span></a>`).join('')}</div>`;
};
