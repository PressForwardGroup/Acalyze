import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { scope, resolveCenter } from '../lib/scope.js';
import { isScienceSubject } from '../lib/grading.js';
import { sectionProblem, enabledSections } from '../lib/sections.js';
import { catalogueFor } from '../lib/curriculum.js';
import { buildIndex, resolveSubject, normaliseKey } from '../lib/subjectResolver.js';

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
  const secProblem = await sectionProblem(req.auth.organizationId, section || null);
  if (secProblem) return res.status(400).json({ error: secProblem });
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

// Adds the official KNEC / KICD subjects for the sections this school uses. Safe to run again: existing names are left alone.
subjectsRouter.post('/seed-curriculum', requireRole('admin'), asyncHandler(async (req, res) => {
  const center = await resolveCenter(req, req.body?.centerId);
  if (!center) return res.status(400).json({ error: 'Choose which campus to add the subjects to (centerId).' });
  const sections = await enabledSections(req.auth.organizationId);
  let added = 0;
  for (const r of catalogueFor(sections)) {
    const { rowCount } = await query(
      `INSERT INTO subjects (organization_id, center_id, name, code, section, is_science)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (center_id, name) DO NOTHING`,
      [req.auth.organizationId, center, r.name, r.code, r.section, r.isScience]);
    added += rowCount;
  }
  res.json({ sections, added, total: catalogueFor(sections).length });
}));

// Which subject does each name mean? Answers matched / part / suggested / ask / unknown (see lib/subjectResolver.js).
subjectsRouter.post('/resolve', requireRole('admin', 'teacher'), asyncHandler(async (req, res) => {
  const names = Array.isArray(req.body?.names) ? req.body.names.slice(0, 200) : [];
  const sections = await enabledSections(req.auth.organizationId);
  const saved = (await query(
    `SELECT a.alias_text AS alias, s.name AS subject FROM subject_aliases a JOIN subjects s ON s.id = a.subject_id WHERE a.organization_id = $1`,
    [req.auth.organizationId])).rows;
  const index = buildIndex({ sections, saved });
  const s = scope(req);
  const byName = new Map((await query(`SELECT id, name FROM subjects WHERE ${s.sql}`, s.params)).rows.map((r) => [r.name, r.id]));
  res.json(names.map((n) => {
    const r = resolveSubject(n, index, { section: req.body.section, className: req.body.className });
    return { ...r, subjectId: r.subject ? byName.get(r.subject) || null : null };
  }));
}));

// The answer to "which subject is this?" - saved so it is never asked again.
subjectsRouter.post('/aliases', requireRole('admin', 'teacher'), asyncHandler(async (req, res) => {
  const { alias, subjectId } = req.body || {};
  const key = normaliseKey(alias);
  if (!key || !subjectId) return res.status(400).json({ error: 'alias and subjectId are required' });
  const s = scope(req);
  const sub = (await query(`SELECT id FROM subjects WHERE id = $${s.params.length + 1} AND ${s.sql}`, [...s.params, subjectId])).rows[0];
  if (!sub) return res.status(404).json({ error: 'Subject not found' });
  await query(
    `INSERT INTO subject_aliases (organization_id, alias_key, alias_text, subject_id) VALUES ($1,$2,$3,$4)
     ON CONFLICT (organization_id, alias_key) DO UPDATE SET subject_id = EXCLUDED.subject_id, alias_text = EXCLUDED.alias_text`,
    [req.auth.organizationId, key, String(alias).trim().slice(0, 80), subjectId]);
  res.status(201).json({ alias: String(alias).trim(), subjectId });
}));
