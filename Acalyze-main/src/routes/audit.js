import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { can } from '../lib/permissions.js';

// The school's audit trail: who did what, and when. Money entries are only shown to the principal.
export const auditRouter = Router();
auditRouter.use(requireAuth, requirePerm('audit.view'));

auditRouter.get('/', asyncHandler(async (req, res) => {
  const seeFinance = can(req.auth.role, 'audit.view_finance') || !!req.auth.actingAsPlatformAdmin;
  const areas = seeFinance ? ['security', 'academic', 'finance'] : ['security', 'academic'];
  const want = String(req.query.area || '');
  const use = areas.includes(want) ? [want] : areas;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const { rows } = await query(
    `SELECT al.id, al.area, al.action, al.entity, al.entity_id, al.actor_role, al.detail, al.created_at,
            COALESCE(a.full_name, pa.full_name, t.full_name) AS actor_name
     FROM audit_log al
     LEFT JOIN admins a ON a.id::text = al.actor_id
     LEFT JOIN platform_admins pa ON pa.id::text = al.actor_id
     LEFT JOIN teachers t ON t.id::text = al.actor_id
     WHERE al.organization_id = $1 AND al.area = ANY($2)
     ORDER BY al.created_at DESC LIMIT $3`, [req.auth.organizationId, use, limit]);
  res.json({ areas, events: rows });
}));
