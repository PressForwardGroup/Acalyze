import { query } from './db.js';

// Writes one line to the school's audit trail: who did what, and when.
// area: 'security' | 'academic' | 'finance' | 'platform'. It never throws, so a logging problem can never break the action itself.
export async function audit(req, { area = 'academic', action, entity = null, entityId = null, detail = null, organizationId } = {}) {
  try {
    const a = req?.auth || {};
    const org = organizationId !== undefined ? organizationId : (a.organizationId ?? null);
    await query(
      `INSERT INTO audit_log (organization_id, area, action, entity, entity_id, actor_role, actor_id, detail, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [org, area, action, entity, entityId == null ? null : String(entityId), a.actingAsPlatformAdmin ? 'platform_admin' : (a.role || null),
        a.sub == null ? null : String(a.sub), detail ? JSON.stringify(detail) : null, req?.ip || null]);
  } catch (e) { console.error('audit log failed:', e.message); }
}
