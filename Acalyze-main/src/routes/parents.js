import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireFeature } from '../lib/plans.js';
import { hashPassword } from '../lib/auth.js';
import { linkParent, normPhone, tempPassword } from '../lib/parents.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const parentsRouter = Router();
parentsRouter.use(requireAuth, requireRole('admin'), requireFeature('parents'));

parentsRouter.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.full_name, p.phone, p.password_changed, p.created_at,
            COALESCE(json_agg(json_build_object('id', s.id, 'name', s.full_name, 'class', c.name))
                     FILTER (WHERE s.id IS NOT NULL), '[]') AS children
     FROM parents p
     LEFT JOIN parent_students ps ON ps.parent_id = p.id
     LEFT JOIN students s ON s.id = ps.student_id
     LEFT JOIN classes c ON c.id = s.class_id
     WHERE p.organization_id = $1 GROUP BY p.id ORDER BY p.full_name NULLS LAST, p.phone`, [req.auth.organizationId]);
  res.json(rows);
}));

// Link a (new or existing) parent phone to one more child. A brand-new parent
// account returns a temporary password ONCE for the admin to hand over.
parentsRouter.post('/link', asyncHandler(async (req, res) => {
  const { studentId, phone, name } = req.body;
  if (!studentId || !phone) return res.status(400).json({ error: 'studentId and phone are required' });
  const st = await query(`SELECT id FROM students WHERE id = $1 AND organization_id = $2`, [studentId, req.auth.organizationId]);
  if (!st.rows[0]) return res.status(404).json({ error: 'Student not found at your school' });
  const created = await linkParent({ organizationId: req.auth.organizationId, studentId, parentName: name, parentPhone: phone });
  res.json({ ok: true, newParentLogin: created });
}));

// New temporary password for a parent who is locked out; they must change it at next sign-in.
parentsRouter.post('/:id/reset', asyncHandler(async (req, res) => {
  const pw = tempPassword();
  const r = await query(`UPDATE parents SET password_hash = $1, password_changed = false WHERE id = $2 AND organization_id = $3 RETURNING phone`,
    [await hashPassword(pw), req.params.id, req.auth.organizationId]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Parent not found' });
  res.json({ ok: true, phone: r.rows[0].phone, tempPassword: pw });
}));

parentsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const r = await query(`DELETE FROM parents WHERE id = $1 AND organization_id = $2`, [req.params.id, req.auth.organizationId]);
  if (!r.rowCount) return res.status(404).json({ error: 'Parent not found' });
  res.status(204).end();
}));
