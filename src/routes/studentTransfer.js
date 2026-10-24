import { Router } from 'express';
import { query, pool } from '../lib/db.js';
import { audit } from '../lib/audit.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { computeExamResults } from '../lib/results.js';

// Student tools: moving students between classes/campuses, class-teacher
// results, bulk delete, admission-number checks and "main subjects".
// Mounted at /student-transfer. EVERYTHING here is scoped to the caller's own
// organization. There is deliberately NO way to move a student between two
// different schools — they are separate customers with separate data.
export const studentTransferRouter = Router();
studentTransferRouter.use(requireAuth);

// Move one or many students into a class (any campus of the same school). Applies immediately.
studentTransferRouter.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const ids = (Array.isArray(req.body.studentIds) ? req.body.studentIds : [req.body.studentId]).filter(Boolean);
  const { classId } = req.body;
  if (!ids.length || !classId) return res.status(400).json({ error: 'Choose the students and the class to move them to.' });
  const cls = await query(`SELECT id, center_id FROM classes WHERE id = $1 AND organization_id = $2`, [classId, req.auth.organizationId]);
  if (!cls.rows[0]) return res.status(404).json({ error: 'That class was not found at your school.' });
  const r = await query(
    `UPDATE students SET class_id = $1, center_id = $2 WHERE id = ANY($3::uuid[]) AND organization_id = $4`,
    [classId, cls.rows[0].center_id, ids, req.auth.organizationId]);
  res.json({ moved: r.rowCount });
}));

// ---------- Year-end promotion ----------
// Moves one class up in a single step. Each student is promoted (moves to the next class), repeats (stays), or
// leaves (marked "left"; the record and marks are kept). Only students who are really in the class can be touched,
// and either every change is saved or none is.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
studentTransferRouter.post('/promote', requireRole('admin'), asyncHandler(async (req, res) => {
  const { fromClassId, toClassId } = req.body;
  const outcomes = Array.isArray(req.body.outcomes) ? req.body.outcomes : [];
  const org = req.auth.organizationId;
  if (!UUID.test(String(fromClassId)) || !outcomes.length) return res.status(400).json({ error: 'Choose the class and an outcome for each student.' });
  if (outcomes.some((o) => !UUID.test(String(o.studentId)) || !['promote', 'repeat', 'leave'].includes(o.outcome))) return res.status(400).json({ error: 'Each student needs one outcome: promote, repeat or leave.' });
  const ids = [...new Set(outcomes.map((o) => o.studentId))];
  const idsOf = (k) => outcomes.filter((o) => o.outcome === k).map((o) => o.studentId);
  const promoteIds = idsOf('promote'), leaveIds = idsOf('leave'), repeatIds = idsOf('repeat');
  const wanted = [fromClassId, ...(UUID.test(String(toClassId)) ? [toClassId] : [])];
  const cls = (await query(`SELECT id, name, center_id FROM classes WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [org, wanted])).rows;
  const from = cls.find((c) => c.id === fromClassId), to = cls.find((c) => c.id === toClassId);
  if (!from) return res.status(404).json({ error: 'That class was not found at your school.' });
  if (promoteIds.length && !to) return res.status(400).json({ error: 'Choose the class to promote into.' });
  if (promoteIds.length && to.id === from.id) return res.status(400).json({ error: 'Pick a different class to promote into.' });
  const inClass = await query(`SELECT id FROM students WHERE organization_id = $1 AND class_id = $2 AND id = ANY($3::uuid[])`, [org, fromClassId, ids]);
  if (inClass.rowCount !== ids.length) return res.status(400).json({ error: 'Some of these students are no longer in that class. Reload the page and try again.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (promoteIds.length) await client.query(`UPDATE students SET class_id = $1, center_id = $2 WHERE id = ANY($3::uuid[]) AND organization_id = $4`, [to.id, to.center_id, promoteIds, org]);
    if (leaveIds.length) await client.query(`UPDATE students SET status = 'left' WHERE id = ANY($1::uuid[]) AND organization_id = $2`, [leaveIds, org]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  await audit(req, { action: 'students.promoted', entity: 'class', entityId: from.id, detail: { from: from.name, to: to?.name || null, promoted: promoteIds.length, repeated: repeatIds.length, left: leaveIds.length } });
  res.json({ promoted: promoteIds.length, repeated: repeatIds.length, left: leaveIds.length, undo: { fromClassId, promotedIds: promoteIds, leftIds: leaveIds } });
}));

// Put a promotion back: promoted students return to their old class, and students marked as left become active again.
studentTransferRouter.post('/promote/undo', requireRole('admin'), asyncHandler(async (req, res) => {
  const { fromClassId } = req.body, org = req.auth.organizationId;
  const clean = (a) => (Array.isArray(a) ? a : []).filter((x) => UUID.test(String(x)));
  const promotedIds = clean(req.body.promotedIds), leftIds = clean(req.body.leftIds);
  const from = UUID.test(String(fromClassId)) ? (await query(`SELECT id, name, center_id FROM classes WHERE id = $1 AND organization_id = $2`, [fromClassId, org])).rows[0] : null;
  if (!from) return res.status(404).json({ error: 'That class was not found at your school.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (promotedIds.length) await client.query(`UPDATE students SET class_id = $1, center_id = $2 WHERE id = ANY($3::uuid[]) AND organization_id = $4`, [from.id, from.center_id, promotedIds, org]);
    if (leftIds.length) await client.query(`UPDATE students SET status = 'active' WHERE id = ANY($1::uuid[]) AND organization_id = $2 AND status = 'left'`, [leftIds, org]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  await audit(req, { action: 'students.promotion_undone', entity: 'class', entityId: from.id, detail: { to: from.name, restored: promotedIds.length, reactivated: leftIds.length } });
  res.json({ restored: promotedIds.length, reactivated: leftIds.length });
}));

// ---------- Class teacher: the whole class's results ----------
studentTransferRouter.get('/class-results/mine', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, section FROM classes WHERE class_teacher_id = $1 AND organization_id = $2 ORDER BY name`,
    [req.auth.sub, req.auth.organizationId]);
  res.json(rows);
}));

studentTransferRouter.get('/class-results', requireRole('teacher', 'admin'), asyncHandler(async (req, res) => {
  const { examId, classId } = req.query;
  if (!examId || !classId) return res.status(400).json({ error: 'examId and classId are required' });
  if (req.auth.role === 'teacher') {
    const own = await query(`SELECT 1 FROM classes WHERE id = $1 AND class_teacher_id = $2 AND organization_id = $3`,
      [classId, req.auth.sub, req.auth.organizationId]);
    if (!own.rows[0]) return res.status(403).json({ error: 'You are not the class teacher of this class.' });
  }
  const data = await computeExamResults({ organizationId: req.auth.organizationId, examId, classId });
  if (!data) return res.status(404).json({ error: 'Class not found' });
  res.json({ class: data.class, scheme: data.scheme, subjects: data.subjects,
             results: data.rows.filter((r) => r.classId === classId) });
}));

// ---------- Admission numbers ----------
// Unique per school (a database constraint), so "duplicates" cannot exist; these just
// help an import check a list before uploading it.
const keyOf = (v) => String(v || '').trim().toUpperCase();
studentTransferRouter.post('/check-ids', requireRole('admin'), asyncHandler(async (req, res) => {
  const keys = (Array.isArray(req.body.ids) ? req.body.ids : []).map(keyOf).filter(Boolean);
  if (!keys.length) return res.json({ taken: [] });
  const r = await query(
    `SELECT DISTINCT upper(trim(school_id_number)) AS k FROM students
     WHERE organization_id = $1 AND upper(trim(school_id_number)) = ANY($2)`, [req.auth.organizationId, keys]);
  res.json({ taken: r.rows.map((x) => x.k) });
}));

// Delete many students at once; their marks and remarks go with them (cascade).
studentTransferRouter.post('/delete-students', requireRole('admin'), asyncHandler(async (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'Choose at least one student.' });
  const r = await query(`DELETE FROM students WHERE id = ANY($1::uuid[]) AND organization_id = $2`, [ids, req.auth.organizationId]);
  if (!r.rowCount) return res.status(404).json({ error: 'Those students were not found at your school.' });
  res.json({ deleted: r.rowCount });
}));

// ---------- Main subjects (always shown on the report card) ----------
studentTransferRouter.get('/main-subjects', requireRole('admin', 'teacher'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT m.subject_id, s.name FROM main_subjects m JOIN subjects s ON s.id = m.subject_id
     WHERE m.organization_id = $1 ORDER BY s.name`, [req.auth.organizationId]);
  res.json(rows);
}));

studentTransferRouter.post('/main-subjects', requireRole('admin'), asyncHandler(async (req, res) => {
  const { subjectId, isMain } = req.body;
  const ok = await query(`SELECT 1 FROM subjects WHERE id = $1 AND organization_id = $2`, [subjectId, req.auth.organizationId]);
  if (!ok.rows[0]) return res.status(404).json({ error: 'Subject not found at your school.' });
  if (isMain) await query(`INSERT INTO main_subjects (subject_id, organization_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [subjectId, req.auth.organizationId]);
  else await query(`DELETE FROM main_subjects WHERE subject_id = $1 AND organization_id = $2`, [subjectId, req.auth.organizationId]);
  res.json({ ok: true });
}));

studentTransferRouter.post('/main-subjects/defaults', requireRole('admin'), asyncHandler(async (req, res) => {
  const r = await query(
    `INSERT INTO main_subjects (subject_id, organization_id)
     SELECT id, organization_id FROM subjects
     WHERE organization_id = $1 AND name ILIKE ANY (ARRAY['math%', 'english%', 'kiswahili%'])
     ON CONFLICT DO NOTHING`, [req.auth.organizationId]);
  res.json({ added: r.rowCount });
}));
