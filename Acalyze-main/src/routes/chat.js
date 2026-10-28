import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireFeature } from '../lib/plans.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const chatRouter = Router();
chatRouter.use(requireAuth, requireRole('parent', 'teacher'), requireFeature('chat'));

// Who can this person message? A parent can message teachers who teach (or are
// class teacher of) their own child's class. A teacher can message parents of
// children in the classes they teach. Nobody else — enforced here, not in the UI.
chatRouter.get('/contacts', asyncHandler(async (req, res) => {
  const org = req.auth.organizationId;
  if (req.auth.role === 'parent') {
    const { rows } = await query(
      `SELECT DISTINCT t.id, t.full_name, s.full_name AS child, c.name AS class_name,
         (SELECT count(*)::int FROM messages m WHERE m.parent_id = $1 AND m.teacher_id = t.id AND m.sender = 'teacher' AND m.read_at IS NULL) AS unread
       FROM parent_students ps
       JOIN students s ON s.id = ps.student_id AND s.organization_id = $2
       JOIN classes c ON c.id = s.class_id
       JOIN teachers t ON t.organization_id = $2 AND (
            t.id = c.class_teacher_id OR EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id = t.id AND ta.class_id = c.id))
       WHERE ps.parent_id = $1 ORDER BY t.full_name`, [req.auth.sub, org]);
    return res.json(rows);
  }
  const { rows } = await query(
    `SELECT DISTINCT p.id, COALESCE(p.full_name, p.phone) AS full_name, s.full_name AS child, c.name AS class_name,
       (SELECT count(*)::int FROM messages m WHERE m.teacher_id = $1 AND m.parent_id = p.id AND m.sender = 'parent' AND m.read_at IS NULL) AS unread
     FROM teachers t
     JOIN classes c ON c.organization_id = $2 AND (c.class_teacher_id = t.id OR EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id = t.id AND ta.class_id = c.id))
     JOIN students s ON s.class_id = c.id AND s.status = 'active'
     JOIN parent_students ps ON ps.student_id = s.id
     JOIN parents p ON p.id = ps.parent_id
     WHERE t.id = $1 ORDER BY 2`, [req.auth.sub, org]);
  res.json(rows);
}));

async function allowed(req, otherId) {
  const parentId = req.auth.role === 'parent' ? req.auth.sub : otherId;
  const teacherId = req.auth.role === 'teacher' ? req.auth.sub : otherId;
  const { rows } = await query(
    `SELECT 1 FROM parent_students ps
     JOIN students s ON s.id = ps.student_id AND s.organization_id = $3
     JOIN classes c ON c.id = s.class_id
     WHERE ps.parent_id = $1 AND (c.class_teacher_id = $2 OR EXISTS
       (SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id = $2 AND ta.class_id = c.id)) LIMIT 1`,
    [parentId, teacherId, req.auth.organizationId]);
  return rows[0] ? { parentId, teacherId } : null;
}

chatRouter.get('/thread', asyncHandler(async (req, res) => {
  const { withId } = req.query;
  if (!withId) return res.status(400).json({ error: 'withId is required' });
  const pair = await allowed(req, withId);
  if (!pair) return res.status(403).json({ error: 'You can only message people connected to your own class or child.' });
  const mine = req.auth.role;
  await query(`UPDATE messages SET read_at = now() WHERE parent_id = $1 AND teacher_id = $2 AND sender <> $3 AND read_at IS NULL`,
    [pair.parentId, pair.teacherId, mine]);
  const { rows } = await query(
    `SELECT id, sender, body, created_at, student_id FROM messages WHERE parent_id = $1 AND teacher_id = $2 AND organization_id = $3 ORDER BY created_at`,
    [pair.parentId, pair.teacherId, req.auth.organizationId]);
  res.json(rows.map((m) => ({ ...m, mine: m.sender === mine })));
}));

chatRouter.post('/send', asyncHandler(async (req, res) => {
  const { toId, body, studentId } = req.body;
  const text = String(body || '').trim();
  if (!toId || !text) return res.status(400).json({ error: 'toId and body are required' });
  if (text.length > 2000) return res.status(400).json({ error: 'Message is too long (2000 characters max).' });
  const pair = await allowed(req, toId);
  if (!pair) return res.status(403).json({ error: 'You can only message people connected to your own class or child.' });
  const { rows } = await query(
    `INSERT INTO messages (organization_id, parent_id, teacher_id, student_id, sender, body)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, sender, body, created_at`,
    [req.auth.organizationId, pair.parentId, pair.teacherId, studentId || null, req.auth.role, text]);
  res.status(201).json({ ...rows[0], mine: true });
}));

chatRouter.get('/unread', asyncHandler(async (req, res) => {
  const col = req.auth.role === 'parent' ? 'parent_id' : 'teacher_id';
  const other = req.auth.role === 'parent' ? 'teacher' : 'parent';
  const { rows } = await query(`SELECT count(*)::int AS n FROM messages WHERE ${col} = $1 AND sender = $2 AND read_at IS NULL`, [req.auth.sub, other]);
  res.json({ unread: rows[0].n });
}));
