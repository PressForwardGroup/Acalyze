import { Router } from 'express';
import { query, pool } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveCenter } from '../lib/scope.js';
import { planImport, applyImport } from '../lib/importer.js';

export const importRouter = Router();
importRouter.use(requireAuth, requireRole('admin'));

// Import a school's marks-entry workbook (already read in the browser).
// Body: { sheets, importMarks, examId | newExam:{name,term,academicYear}, centerId, dryRun }
// dryRun = true returns what WOULD happen and writes nothing.
importRouter.post('/workbook', asyncHandler(async (req, res) => {
  const { sheets, importMarks = true, examId, newExam, centerId, dryRun = false } = req.body;
  const org = req.auth.organizationId;
  if (!Array.isArray(sheets) || !sheets.length) return res.status(400).json({ error: 'Choose at least one sheet to import.' });
  if (sheets.length > 12 || sheets.reduce((n, s) => n + (s.students?.length || 0), 0) > 20000) return res.status(400).json({ error: 'That workbook is too large to import in one go.' });

  const center = await resolveCenter(req, centerId);
  if (!center) return res.status(400).json({ error: 'Choose which campus to import into (centerId).' });
  if (importMarks && !dryRun && !examId && !newExam?.name) return res.status(400).json({ error: 'Choose an exam for the marks, or create a new one.' });
  if (examId) {
    const ok = await query(`SELECT 1 FROM exams WHERE id = $1 AND organization_id = $2`, [examId, org]);
    if (!ok.rows[0]) return res.status(404).json({ error: 'Exam not found at your school' });
  }

  const [classes, subjects, students] = await Promise.all([
    query(`SELECT id, name FROM classes WHERE organization_id = $1`, [org]),
    query(`SELECT id, name, code FROM subjects WHERE organization_id = $1`, [org]),
    query(`SELECT id, school_id_number, class_id FROM students WHERE organization_id = $1`, [org]),
  ]);
  const plan = planImport({ sheets, existing: { classes: classes.rows, subjects: subjects.rows, students: students.rows }, importMarks });
  if (dryRun) return res.json({ dryRun: true, summary: plan.summary, skipped: plan.skipped });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let useExam = examId || null;
    if (importMarks && !useExam) {
      const e = await client.query(
        `INSERT INTO exams (organization_id, center_id, name, term, academic_year) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [org, center, String(newExam.name).trim().slice(0, 120), newExam.term || null, newExam.academicYear || null]);
      useExam = e.rows[0].id;
    }
    const out = await applyImport(client, { organizationId: org, centerId: center, examId: importMarks ? useExam : null, plan });
    await client.query('COMMIT');
    res.json({ summary: { ...plan.summary, marksSaved: out.marksSaved }, skipped: plan.skipped, examId: useExam });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));
