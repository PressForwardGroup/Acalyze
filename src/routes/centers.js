import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const centersRouter = Router();
centersRouter.use(requireAuth);

// A school's own campuses within ITS organization — "centers could be added"
// is now something a school_admin does for their own school, not a
// platform-level action. Creating a brand new organization happens only
// through registration approval (see routes/organizations.js).

centersRouter.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT * FROM centers WHERE organization_id = $1 ORDER BY name`, [req.auth.organizationId]);
  res.json(rows);
}));

centersRouter.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const { name, centerCode, location } = req.body;
  if (!name || !centerCode) return res.status(400).json({ error: 'name and centerCode are required' });

  const dupe = await query(
    `SELECT id FROM centers WHERE organization_id = $1 AND center_code = $2`,
    [req.auth.organizationId, centerCode.trim().toUpperCase()]
  );
  if (dupe.rows[0]) return res.status(409).json({ error: `Center code "${centerCode}" is already in use at your school` });

  const { rows } = await query(
    `INSERT INTO centers (organization_id, name, center_code, location) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.auth.organizationId, name, centerCode.trim().toUpperCase(), location || null]
  );
  res.status(201).json(rows[0]);
}));

centersRouter.patch('/:id/active', requireRole('admin'), asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  const { rows } = await query(
    `UPDATE centers SET is_active = $1 WHERE id = $2 AND organization_id = $3 RETURNING *`,
    [!!isActive, req.params.id, req.auth.organizationId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Center not found' });
  res.json(rows[0]);
}));

// Headline numbers for this school's own Overview dashboard.
centersRouter.get('/org-stats', asyncHandler(async (req, res) => {
  const orgId = req.auth.organizationId;
  const [centers, students, teachers, perCenter] = await Promise.all([
    query(`SELECT count(*)::int AS n FROM centers WHERE organization_id = $1 AND is_active = true`, [orgId]),
    query(`SELECT count(*)::int AS n FROM students WHERE organization_id = $1`, [orgId]),
    query(`SELECT count(*)::int AS n FROM teachers WHERE organization_id = $1`, [orgId]),
    query(`
      SELECT c.id, c.name,
        (SELECT count(*)::int FROM students s WHERE s.center_id = c.id) AS student_count,
        (SELECT count(*)::int FROM teachers t WHERE t.center_id = c.id) AS teacher_count
      FROM centers c WHERE c.organization_id = $1 AND c.is_active = true ORDER BY c.name
    `, [orgId]),
  ]);
  res.json({
    centers: centers.rows[0].n,
    students: students.rows[0].n,
    teachers: teachers.rows[0].n,
    perCenter: perCenter.rows,
  });
}));
