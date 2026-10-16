import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { scope, resolveCenter } from '../lib/scope.js';

export const examsRouter = Router();
examsRouter.use(requireAuth);

// Parents only ever see published exams, enforced here and not just in the UI.
examsRouter.get('/', asyncHandler(async (req, res) => {
  const onlyPublished = req.auth.role === 'parent';
  const s = scope(req);
  const { rows } = await query(
    `SELECT * FROM exams WHERE ${s.sql} ${onlyPublished ? 'AND is_published = true' : ''} ORDER BY created_at DESC`, s.params);
  res.json(rows);
}));

examsRouter.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const { name, term, academicYear, opensOn, closesOn, newsletter, centerId } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const center = await resolveCenter(req, centerId);
  if (!center) return res.status(400).json({ error: 'Choose which campus this exam belongs to (centerId).' });
  const { rows } = await query(
    `INSERT INTO exams (organization_id, center_id, name, term, academic_year, opens_on, closes_on, newsletter)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.auth.organizationId, center, name, term || null, academicYear || null, opensOn || null, closesOn || null, newsletter || null]);
  res.status(201).json(rows[0]);
}));

examsRouter.patch('/:id/publish', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE exams SET is_published = $1 WHERE id = $2 AND organization_id = $3 RETURNING *`,
    [!!req.body.isPublished, req.params.id, req.auth.organizationId]);
  if (!rows[0]) return res.status(404).json({ error: 'Exam not found' });
  res.json(rows[0]);
}));

examsRouter.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rowCount } = await query(`DELETE FROM exams WHERE id = $1 AND organization_id = $2`, [req.params.id, req.auth.organizationId]);
  if (!rowCount) return res.status(404).json({ error: 'Exam not found' });
  res.status(204).end();
}));
