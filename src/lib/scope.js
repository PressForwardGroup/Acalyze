import { query } from './db.js';

// Tenant scoping in one place so no route can forget it.
//   admin   -> sees every center in THEIR organization
//   teacher -> sees only their own center (still inside their organization)
// organizationId always comes from the verified JWT, never from the request.
export function scope(req, { alias = '', startAt = 1 } = {}) {
  const p = alias ? `${alias}.` : '';
  const params = [req.auth.organizationId];
  let sql = `${p}organization_id = $${startAt}`;
  if (req.auth.role === 'teacher' && req.auth.centerId) {
    params.push(req.auth.centerId);
    sql += ` AND ${p}center_id = $${startAt + 1}`;
  }
  return { sql, params };
}

// Which center should a new row belong to?
//  - teachers: their own center
//  - admins:   body.centerId (must belong to their org), or the org's only center
export async function resolveCenter(req, bodyCenterId) {
  if (req.auth.centerId) return req.auth.centerId;
  const { rows } = await query(
    `SELECT id FROM centers WHERE organization_id = $1 AND is_active = true ORDER BY created_at`,
    [req.auth.organizationId]
  );
  if (bodyCenterId) {
    return rows.find((c) => c.id === bodyCenterId)?.id || null;
  }
  return rows.length === 1 ? rows[0].id : null;
}

// 8-4-4 classes are "Form N"; everything else is CBC. Same rule the
// Gradebook Analyzer used to pick a scheme per class sheet.
export function schemeForGrade(grade, orgDefault = 'cbc') {
  if (/form\s*\d/i.test(grade)) return '844';
  if (/grade\s*\d/i.test(grade)) return 'cbc';
  return orgDefault;
}

export function formLevelOf(grade) {
  const m = String(grade || '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}
