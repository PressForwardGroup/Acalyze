import { query } from './db.js';

// Is this school allowed to use the system right now? Cached for 30s so
// suspending a school takes effect within half a minute without a database
// lookup on every single request.
const cache = new Map();
const TTL = 30_000;

export async function orgIsActive(organizationId) {
  const hit = cache.get(organizationId);
  if (hit && hit.until > Date.now()) return hit.active;
  const { rows } = await query(`SELECT status FROM organizations WHERE id = $1`, [organizationId]);
  const active = rows[0]?.status === 'active';
  cache.set(organizationId, { active, until: Date.now() + TTL });
  return active;
}
export function forgetOrgStatus(organizationId) { cache.delete(organizationId); }
