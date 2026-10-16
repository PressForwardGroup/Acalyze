import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { scope, resolveCenter, schemeForGrade } from '../lib/scope.js';

export const classesRouter = Router();
classesRouter.use(requireAuth);

classesRouter.get('/', requireRole('admin', 'teacher'), asyncHandler(async (req, res) => {
  const s = scope(req, { alias: 'c' });
  const { rows } = await query(
    `SELECT c.*, t.full_name AS class_teacher_name,
            (SELECT count(*)::int FROM students st WHERE st.class_id = c.id AND st.status = 'active') AS student_count
     FROM classes c LEFT JOIN teachers t ON t.id = c.class_teacher_id
     WHERE ${s.sql} ORDER BY c.grade, c.stream`, s.params);
  res.json(rows);
}));

classesRouter.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const { name, grade, stream, section, academicYear, centerId, gradingScheme } = req.body;
  if (!name || !grade || !section) return res.status(400).json({ error: 'name, grade and section are required' });
  const center = await resolveCenter(req, centerId);
  if (!center) return res.status(400).json({ error: 'Choose which campus this class belongs to (centerId).' });
  const org = await query(`SELECT default_grading_scheme FROM organizations WHERE id = $1`, [req.auth.organizationId]);
  const scheme = gradingScheme || schemeForGrade(grade, org.rows[0]?.default_grading_scheme);
  const { rows } = await query(
    `INSERT INTO classes (organization_id, center_id, name, grade, stream, section, grading_scheme, academic_year)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.auth.organizationId, center, name, grade, stream || null, section, scheme, academicYear || null]);
  res.status(201).json(rows[0]);
}));

classesRouter.patch('/:id/class-teacher', requireRole('admin'), asyncHandler(async (req, res) => {
  const { teacherId } = req.body;
  if (teacherId) {
    const t = await query(`SELECT id FROM teachers WHERE id = $1 AND organization_id = $2`, [teacherId, req.auth.organizationId]);
    if (!t.rows[0]) return res.status(404).json({ error: 'Teacher not found at your school' });
  }
  const { rows } = await query(
    `UPDATE classes SET class_teacher_id = $1 WHERE id = $2 AND organization_id = $3 RETURNING *`,
    [teacherId || null, req.params.id, req.auth.organizationId]);
  if (!rows[0]) return res.status(404).json({ error: 'Class not found' });
  res.json(rows[0]);
}));

classesRouter.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rowCount } = await query(`DELETE FROM classes WHERE id = $1 AND organization_id = $2`, [req.params.id, req.auth.organizationId]);
  if (!rowCount) return res.status(404).json({ error: 'Class not found' });
  res.status(204).end();
}));
