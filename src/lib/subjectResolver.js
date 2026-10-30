// Turns whatever a teacher or a spreadsheet calls a subject ("Kisw", "SCIE&TECNO", "HAG", "Eng 2")
// into a real subject, or asks. Nothing here guesses silently:
//   matched    the name (or a short name / saved alias) is known - use it
//   part       it is one paper/part of a subject (Grammar, Lugha, ENG 2) - belongs to `subject`
//   suggested  close to exactly one subject - show it and ask the person to confirm
//   ask        the same short name means different subjects (e.g. COMP) - ask which
//   unknown    nothing close - ask, and let the person pick or add the subject
// Whatever the person answers is saved as an alias (subject_aliases), so the question is asked once.
import { catalogueFor, bandsOfSection, bandFor, BAND_SECTION } from './curriculum.js';

// "SCIE&TECNO", "scie & tecno" and "Scie-Tecno" all become SCIETECNO. AND / OF are dropped so "&" and "and" agree.
export function normaliseKey(s) {
  return String(s ?? '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim()
    .split(' ').filter((w) => w && w !== 'AND' && w !== 'OF').join('');
}

function distance(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// sections: the school's enabled sections. saved: [{ alias, subject }] answers people gave before.
export function buildIndex({ sections, saved = [] } = {}) {
  const map = new Map();                 // key -> [{ kind, name, parent?, bands }]
  const put = (text, entry) => {
    const key = normaliseKey(text); if (!key) return;
    const list = map.get(key) || [];
    const dup = list.find((e) => e.kind === entry.kind && e.name === entry.name && e.parent === entry.parent);
    if (dup) entry.bands.forEach((b) => !dup.bands.includes(b) && dup.bands.push(b)); else list.push({ ...entry, bands: [...entry.bands] });
    map.set(key, list);
  };
  for (const r of catalogueFor(sections)) {
    for (const t of [r.name, r.short, ...r.aliases]) put(t, { kind: 'subject', name: r.name, bands: r.bands });
    for (const p of r.parts) put(p, { kind: 'part', name: p, parent: r.name, bands: r.partBands.filter((b) => r.bands.includes(b)) });
    for (const [t, bs] of Object.entries(r.extraAliasBands)) put(t, { kind: 'subject', name: r.name, bands: bs.filter((b) => r.bands.includes(b)) });
  }
  const custom = new Map(saved.map((a) => [normaliseKey(a.alias), a.subject]));
  return { map, custom };
}

function scopeBands({ section, band, className } = {}) {
  const b = band || bandFor(className);
  if (b) return [b];
  if (section) return bandsOfSection(section);
  return null;                            // no context: every band counts
}
const inScope = (e, bands) => !bands || e.bands.some((b) => bands.includes(b));
const named = (e) => (e.kind === 'part' ? { part: e.name, subject: e.parent } : { subject: e.name });

export function resolveSubject(header, index, scope = {}) {
  const key = normaliseKey(header);
  const out = { header: String(header ?? ''), status: 'unknown', suggestions: [] };
  if (!key) return out;
  const bands = scopeBands(scope);

  if (index.custom.has(key)) return { ...out, status: 'matched', via: 'saved', subject: index.custom.get(key) };

  const hits = (index.map.get(key) || []).filter((e) => inScope(e, bands));
  const distinct = [...new Map(hits.map((e) => [`${e.kind}:${e.parent || ''}:${e.name}`, e])).values()];
  if (distinct.length === 1) return { ...out, status: distinct[0].kind === 'part' ? 'part' : 'matched', via: 'name', ...named(distinct[0]) };
  if (distinct.length > 1) return { ...out, status: 'ask', suggestions: distinct.map((e) => e.parent || e.name) };

  // Close matches: a clear prefix ("kisw" -> KISWAHILI) or a one/two-letter slip ("scince").
  const scored = new Map();
  for (const [k, list] of index.map) {
    const live = list.filter((e) => e.kind === 'subject' && inScope(e, bands)); if (!live.length) continue;
    let score = null;
    if (key.length >= 3 && k.startsWith(key)) score = 1 + (k.length - key.length) / 100;
    else { const d = distance(key, k); if (d <= (k.length <= 5 ? 1 : 2) && key.length >= 3) score = 2 + d; }
    if (score != null) for (const e of live) scored.set(e.name, Math.min(scored.get(e.name) ?? 99, score));
  }
  const ranked = [...scored].sort((a, b) => a[1] - b[1]);
  out.suggestions = ranked.slice(0, 3).map(([n]) => n);
  if (ranked.length === 1 || (ranked.length > 1 && ranked[0][1] < ranked[1][1] - 0.5)) return { ...out, status: 'suggested', subject: ranked[0][0] };
  return out;
}

export { bandFor, BAND_SECTION };
