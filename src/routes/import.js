import { Router } from 'express';
import { query, pool } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveCenter } from '../lib/scope.js';
import { planImport, applyImport } from '../lib/importer.js';
import { planSetup, applySetup } from '../lib/setupImport.js';
import { planMarks, applyMarks } from '../lib/marksImport.js';
import { enabledSections } from '../lib/sections.js';
import { catalogueFor } from '../lib/curriculum.js';
import { linkParent } from '../lib/parents.js';

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

// Set a school up from an Excel workbook: teachers (with their classes and subjects) and students.
// Body: { teachers, students, answers, centerId, dryRun } - already read in the browser (public/js/setupExcel.js).
// dryRun = true returns what WOULD happen, plus any "which subject is this?" questions, and writes nothing.
const PARENT_LINK_LIMIT = 120;       // creating a parent login costs a password hash each, so very large imports link parents later

importRouter.post('/setup', asyncHandler(async (req, res) => {
  const { teachers = [], students = [], answers = {}, centerId, dryRun = false } = req.body || {};
  const org = req.auth.organizationId;
  if (!Array.isArray(teachers) || !Array.isArray(students)) return res.status(400).json({ error: 'Send teachers and students as lists.' });
  if (!teachers.length && !students.length) return res.status(400).json({ error: 'There is nothing to import: no teachers or students were found.' });
  if (teachers.length > 2000 || students.length > 20000) return res.status(400).json({ error: 'That workbook is too large to import in one go.' });

  const center = await resolveCenter(req, centerId);
  if (!center) return res.status(400).json({ error: 'Choose which campus to import into (centerId).' });
  const sections = await enabledSections(org);

  const [classes, subjects, teacherRows, studentRows, aliasRows] = await Promise.all([
    query(`SELECT id, name, section FROM classes WHERE organization_id = $1`, [org]),
    query(`SELECT id, name, code FROM subjects WHERE organization_id = $1`, [org]),
    query(`SELECT id, full_name, phone, email FROM teachers WHERE organization_id = $1`, [org]),
    query(`SELECT id, school_id_number, class_id FROM students WHERE organization_id = $1`, [org]),
    query(`SELECT a.alias_text AS alias, s.name AS subject FROM subject_aliases a JOIN subjects s ON s.id = a.subject_id WHERE a.organization_id = $1`, [org]),
  ]);
  const plan = planSetup({
    teachers, students, sections, saved: aliasRows.rows, answers,
    existing: { classes: classes.rows, subjects: subjects.rows, teachers: teacherRows.rows, students: studentRows.rows },
  });
  const choices = [...new Set([...subjects.rows.map((s) => s.name), ...catalogueFor(sections).map((r) => r.name)])].sort((a, b) => a.localeCompare(b));
  if (dryRun) return res.json({ dryRun: true, summary: plan.summary, questions: plan.questions, skipped: plan.skipped, choices });

  const byName = new Map(subjects.rows.map((s) => [s.name.toLowerCase(), s.id]));
  const aliasAnswers = Object.entries(answers).filter(([, a]) => a?.subject).map(([header, a]) => ({ header, subject: a.subject, subjectId: byName.get(String(a.subject).toLowerCase()) || null }));

  const client = await pool.connect();
  let created;
  try {
    await client.query('BEGIN');
    ({ created } = await applySetup(client, { organizationId: org, centerId: center, plan, aliasAnswers }));
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Parent logins are created after the import is safely saved. New accounts get a temporary password to hand over.
  const withPhone = created.filter((c) => c.parentPhone);
  const parentLogins = [];
  for (const c of withPhone.slice(0, PARENT_LINK_LIMIT)) {
    const np = await linkParent({ organizationId: org, studentId: c.id, parentName: c.parentName, parentPhone: c.parentPhone });
    if (np) parentLogins.push({ ...np, student: c.name });
  }
  res.json({ summary: plan.summary, questions: plan.questions, skipped: plan.skipped, parentLogins, parentsNotLinked: Math.max(0, withPhone.length - PARENT_LINK_LIMIT) });
}));

// Marks from a workbook where learners are listed by NAME (already read in the browser: public/js/marksExcel.js).
// Body: { sheets, answers, outOf, examId | newExam:{name,term,academicYear}, centerId, dryRun }
importRouter.post('/marks', asyncHandler(async (req, res) => {
  const { sheets, answers = {}, outOf = {}, examId, newExam, centerId, dryRun = false } = req.body || {};
  const org = req.auth.organizationId;
  if (!Array.isArray(sheets) || !sheets.length) return res.status(400).json({ error: 'No sheets with marks were found.' });
  if (sheets.length > 80 || sheets.reduce((n, s) => n + (s.students?.length || 0), 0) > 20000) return res.status(400).json({ error: 'That workbook is too large to import in one go.' });
  if (!dryRun && !examId && !newExam?.name) return res.status(400).json({ error: 'Choose an exam for the marks, or create a new one.' });
  if (examId) {
    const ok = await query(`SELECT 1 FROM exams WHERE id = $1 AND organization_id = $2`, [examId, org]);
    if (!ok.rows.length) return res.status(404).json({ error: 'Exam not found' });
  }
  const center = await resolveCenter(req, centerId);
  if (!center) return res.status(400).json({ error: 'Choose which campus to import into (centerId).' });
  const sections = await enabledSections(org);

  const [classes, subjects, students, aliasRows] = await Promise.all([
    query(`SELECT id, name, grade, grading_scheme FROM classes WHERE organization_id = $1 AND center_id = $2`, [org, center]),
    query(`SELECT id, name, code FROM subjects WHERE organization_id = $1`, [org]),
    query(`SELECT id, full_name, class_id FROM students WHERE organization_id = $1 AND center_id = $2 AND class_id IS NOT NULL`, [org, center]),
    query(`SELECT a.alias_text AS alias, s.name AS subject FROM subject_aliases a JOIN subjects s ON s.id = a.subject_id WHERE a.organization_id = $1`, [org]),
  ]);
  const plan = planMarks({ sheets, sections, saved: aliasRows.rows, answers, outOf, existing: { classes: classes.rows, subjects: subjects.rows, students: students.rows } });
  const choices = [...new Set([...subjects.rows.map((s) => s.name), ...catalogueFor(sections).map((r) => r.name)])].sort((a, b) => a.localeCompare(b));
  const view = { summary: plan.summary, sheets: plan.sheets, questions: plan.questions, skipped: plan.skipped, outOfHints: plan.outOfHints, choices };
  if (dryRun) return res.json({ dryRun: true, ...view });

  const byName = new Map(subjects.rows.map((s) => [s.name.toLowerCase(), s.id]));
  const aliasAnswers = Object.entries(answers).filter(([, a]) => a?.subject).map(([header, a]) => ({ header, subject: a.subject, subjectId: byName.get(String(a.subject).toLowerCase()) || null }));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let useExam = examId || null;
    if (!useExam) {
      const ex = await client.query(`INSERT INTO exams (organization_id, center_id, name, term, academic_year) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [org, center, String(newExam.name).slice(0, 120), newExam.term || null, newExam.academicYear || null]);
      useExam = ex.rows[0].id;
    }
    const out = await applyMarks(client, { organizationId: org, centerId: center, examId: useExam, plan, aliasAnswers });
    await client.query('COMMIT');
    res.json({ ...view, summary: { ...plan.summary, marksSaved: out.marksSaved }, examId: useExam });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));
