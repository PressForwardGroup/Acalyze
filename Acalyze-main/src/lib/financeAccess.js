import { query } from './db.js';

// Finance belongs to the principal and the finance officer. Until a school has created one of those
// accounts, its school admin keeps access, so nobody is locked out of money records during the switch.
const open = new Map(), principals = new Map();
const TTL = 15_000;

async function cached(map, orgId, sql) {
  const hit = map.get(orgId);
  if (hit && hit.until > Date.now()) return hit.v;
  const v = (await query(sql, [orgId])).rows.length > 0;
  map.set(orgId, { v, until: Date.now() + TTL });
  return v;
}

// true while the school has no active principal or finance officer account
export async function financeOpenToAdmin(orgId) {
  return !(await cached(open, orgId, `SELECT 1 FROM admins WHERE organization_id = $1 AND role_kind IN ('principal','finance') AND active LIMIT 1`));
}
export const hasPrincipal = (orgId) => cached(principals, orgId, `SELECT 1 FROM admins WHERE organization_id = $1 AND role_kind = 'principal' AND active LIMIT 1`);
export function forgetFinanceAccess(orgId) { open.delete(orgId); principals.delete(orgId); }
