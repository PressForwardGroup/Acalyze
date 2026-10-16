import { Router } from 'express';
import { query } from '../lib/db.js';
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
