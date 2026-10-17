import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireFeature } from '../lib/plans.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const calendarRouter = Router();
calendarRouter.use(requireAuth, requireFeature('calendar'));

const KINDS = ['term', 'exam', 'holiday', 'meeting', 'event'];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());

// Everyone at the school can read; parents never see events marked "staff only".
calendarRouter.get('/', requireRole('admin', 'teacher', 'parent'), asyncHandler(async (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : `${new Date().getFullYear()}-01-01`;
  const to = isDate(req.query.to) ? req.query.to : `${new Date().getFullYear() + 1}-12-31`;
  const { rows } = await query(
    `SELECT id, title, description, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on, kind, audience
     FROM events WHERE organization_id = $1 AND COALESCE(ends_on, starts_on) >= $2::date AND starts_on <= $3::date ${req.auth.role === 'parent' ? "AND audience = 'all'" : ''}
     ORDER BY starts_on, title`, [req.auth.organizationId, from, to]);
  res.json(rows);
}));

calendarRouter.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const { title, description, startsOn, endsOn, kind = 'event', audience = 'all' } = req.body;
  if (!String(title || '').trim()) return res.status(400).json({ error: 'Give the event a title.' });
  if (!isDate(startsOn)) return res.status(400).json({ error: 'Choose a start date.' });
  if (endsOn && (!isDate(endsOn) || endsOn < startsOn)) return res.status(400).json({ error: 'The end date must be on or after the start date.' });
  if (!KINDS.includes(kind) || !['all', 'staff'].includes(audience)) return res.status(400).json({ error: 'Invalid event type.' });
  const { rows } = await query(
    `INSERT INTO events (organization_id, title, description, starts_on, ends_on, kind, audience) VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, title, description, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on, kind, audience`,
    [req.auth.organizationId, String(title).trim().slice(0, 120), String(description || '').trim().slice(0, 500) || null, startsOn, endsOn || null, kind, audience]);
  res.status(201).json(rows[0]);
}));

calendarRouter.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const r = await query(`DELETE FROM events WHERE id = $1 AND organization_id = $2`, [req.params.id, req.auth.organizationId]);
  if (!r.rowCount) return res.status(404).json({ error: 'Event not found' });
  res.status(204).end();
}));
