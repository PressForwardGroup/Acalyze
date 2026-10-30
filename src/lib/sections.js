import { query } from './db.js';
import { SECTION_KEYS } from './curriculum.js';

// Which sections (PRIMARY / JUNIOR / SENIOR) a school uses. Set by the platform admin; everything else
// (classes, teachers, subjects, the catalogue) only offers these.
// node-postgres hands back a Postgres enum array as TEXT ("{PRIMARY,JUNIOR}"), not as a list, so every place that
// reads organizations.sections goes through this.
export function parseSections(v) {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.replace(/[{}"]/g, '').split(',') : [];
  const clean = list.map((s) => String(s).trim().toUpperCase()).filter((s) => SECTION_KEYS.includes(s));
  return clean.length ? SECTION_KEYS.filter((s) => clean.includes(s)) : SECTION_KEYS;
}

export async function enabledSections(orgId) {
  const { rows } = await query(`SELECT sections FROM organizations WHERE id = $1`, [orgId]);
  return parseSections(rows[0]?.sections);
}

// null when fine, otherwise a message for the person.
export async function sectionProblem(orgId, section) {
  if (!section) return null;
  const ok = await enabledSections(orgId);
  return ok.includes(section) ? null : `This school does not use the ${section} section (it uses ${ok.join(', ')}). Ask the platform admin to switch it on.`;
}

export function normalizeSections(input) {
  if (!Array.isArray(input) || !input.length) throw new Error('Choose at least one section.');
  const out = [...new Set(input.map((s) => String(s).toUpperCase()))];
  const bad = out.find((s) => !SECTION_KEYS.includes(s));
  if (bad) throw new Error(`Unknown section "${bad}". Use PRIMARY, JUNIOR or SENIOR.`);
  return SECTION_KEYS.filter((s) => out.includes(s));
}
