import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { scope, resolveCenter } from '../lib/scope.js';
import { isScienceSubject } from '../lib/grading.js';

export const subjectsRouter = Router();
subjectsRouter.use(requireAuth);

subjectsRouter.get('/', requireRole('admin', 'teacher'), asyncHandler(async (req, res) => {
  const s = scope(req);
  const { rows } = await query(`SELECT * FROM subjects WHERE ${s.sql} ORDER BY name`, s.params);
  res.json(rows);
}));

subjectsRouter.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const { name, code, section, centerId, isScience } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const center = await resolveCenter(req, centerId);
  if (!center) return res.status(400).json({ error: 'Choose which campus this subject belongs to (centerId).' });
  const sci = isScience ?? isScienceSubject({ code, name });
  const { rows } = await query(
    `INSERT INTO subjects (organization_id, center_id, name, code, section, is_science)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.auth.organizationId, center, name, code || null, section || null, sci]);
  res.status(201).json(rows[0]);
}));

subjectsRouter.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rowCount } = await query(`DELETE FROM subjects WHERE id = $1 AND organization_id = $2`, [req.params.id, req.auth.organizationId]);
  if (!rowCount) return res.status(404).json({ error: 'Subject not found' });
  res.status(204).end();
}));
