import { query } from './db.js';
import { SECTION_KEYS } from './curriculum.js';

// Which sections (PRIMARY / JUNIOR / SENIOR) a school uses. Set by the platform admin; everything else
// (classes, teachers, subjects, the catalogue) only offers these.
export async function enabledSections(orgId) {
  const { rows } = await query(`SELECT sections FROM organizations WHERE id = $1`, [orgId]);
  const s = rows[0]?.sections;
  return Array.isArray(s) && s.length ? s : SECTION_KEYS;
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
