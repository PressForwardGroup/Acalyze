import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { buildMark, saveMark } from '../lib/marks.js';
import { scaleCheck } from '../lib/grading.js';

export const marksRouter = Router();
marksRouter.use(requireAuth);

// Teachers may only touch a class + subject pair assigned to them. Admins are unaffected.
async function teacherAllowed(req, classId, subjectId) {
  if (req.auth.role !== 'teacher') return true;
  const { rows } = await query(
    `SELECT 1 FROM teacher_assignments WHERE teacher_id = $1 AND class_id = $2 AND subject_id = $3`,
    [req.auth.sub, classId, subjectId]);
  return !!rows[0];
}

// Mark-entry grid: every student in a class with their existing mark for one subject/exam.
marksRouter.get('/', requireRole('teacher', 'admin'), asyncHandler(async (req, res) => {
  const { examId, classId, subjectId } = req.query;
  if (!examId || !classId || !subjectId) return res.status(400).json({ error: 'examId, classId and subjectId are required' });
  if (!(await teacherAllowed(req, classId, subjectId))) return res.status(403).json({ error: 'You are not assigned to that class and subject.' });
  const { rows } = await query(
    `SELECT s.id AS student_id, s.full_name, s.school_id_number, m.grade, m.points, m.percent
     FROM students s
     LEFT JOIN marks m ON m.student_id = s.id AND m.exam_id = $1 AND m.subject_id = $2
     WHERE s.class_id = $3 AND s.organization_id = $4 AND s.status = 'active'
     ORDER BY s.full_name`, [examId, subjectId, classId, req.auth.organizationId]);
  res.json(rows);
}));

// Enter or edit one mark. Body: { examId, studentId, subjectId, score, outOf?, grade? }
// Editing an existing mark on a PUBLISHED exam queues an approval request instead.
marksRouter.put('/', requireRole('teacher', 'admin'), asyncHandler(async (req, res) => {
  const { examId, studentId, subjectId, score, outOf, grade } = req.body;
  if (!examId || !studentId || !subjectId) return res.status(400).json({ error: 'examId, studentId and subjectId are required' });
  const org = req.auth.organizationId;

  const exam = await query(`SELECT id, is_published FROM exams WHERE id = $1 AND organization_id = $2`, [examId, org]);
  if (!exam.rows[0]) return res.status(404).json({ error: 'Exam not found at your school' });
  const student = await query(`SELECT id, full_name, class_id FROM students WHERE id = $1 AND organization_id = $2`, [studentId, org]);
  if (!student.rows[0]) return res.status(404).json({ error: 'Student not found at your school' });
  const subject = await query(`SELECT id, name FROM subjects WHERE id = $1 AND organization_id = $2`, [subjectId, org]);
  if (!subject.rows[0]) return res.status(404).json({ error: 'Subject not found at your school' });
  if (!(await teacherAllowed(req, student.rows[0].class_id, subjectId))) return res.status(403).json({ error: 'You are not assigned to that class and subject.' });

  const mark = await buildMark({ organizationId: org, studentId, subjectId, score, outOf, grade });
  if (mark.error) return res.status(400).json({ error: mark.error });
  const teacherId = req.auth.role === 'teacher' ? req.auth.sub : null;

  const existing = await query(`SELECT grade FROM marks WHERE exam_id = $1 AND student_id = $2 AND subject_id = $3`, [examId, studentId, subjectId]);
  if (exam.rows[0].is_published && existing.rows[0]) {
    const { rows } = await query(
      `INSERT INTO edit_requests (organization_id, type, label, old_value, new_value, requested_by_teacher_id, student_id, extra_json)
       VALUES ($1,'MARK',$2,$3,$4,$5,$6,$7) RETURNING *`,
      [org, `Mark: ${subject.rows[0].name} for ${student.rows[0].full_name}`, existing.rows[0].grade, mark.grade, teacherId, studentId,
       JSON.stringify({ examId, studentId, subjectId, score, outOf, grade })]);
    return res.status(202).json({ queued: true, editRequest: rows[0] });
  }
  res.json({ queued: false, mark: await saveMark({ examId, studentId, subjectId, mark, enteredBy: teacherId }) });
}));

marksRouter.delete('/', requireRole('teacher', 'admin'), asyncHandler(async (req, res) => {
  const { examId, studentId, subjectId } = req.query;
  if (!examId || !studentId || !subjectId) return res.status(400).json({ error: 'examId, studentId and subjectId are required' });
  const org = req.auth.organizationId;
  const exam = await query(`SELECT id, is_published FROM exams WHERE id = $1 AND organization_id = $2`, [examId, org]);
  if (!exam.rows[0]) return res.status(404).json({ error: 'Exam not found at your school' });
  const stu = await query(`SELECT class_id, full_name FROM students WHERE id = $1 AND organization_id = $2`, [studentId, org]);
  if (!stu.rows[0]) return res.status(404).json({ error: 'Student not found at your school' });
  if (!(await teacherAllowed(req, stu.rows[0].class_id, subjectId))) return res.status(403).json({ error: 'You are not assigned to that class and subject.' });
  const existing = await query(`SELECT grade FROM marks WHERE exam_id = $1 AND student_id = $2 AND subject_id = $3`, [examId, studentId, subjectId]);
  if (!existing.rows[0]) return res.status(204).end();

  if (exam.rows[0].is_published) {
    const subject = await query(`SELECT name FROM subjects WHERE id = $1 AND organization_id = $2`, [subjectId, org]);
    const teacherId = req.auth.role === 'teacher' ? req.auth.sub : null;
    const { rows } = await query(
      `INSERT INTO edit_requests (organization_id, type, label, old_value, new_value, requested_by_teacher_id, student_id, extra_json)
       VALUES ($1,'MARK',$2,$3,'',$4,$5,$6) RETURNING *`,
      [org, `Mark (clear): ${subject.rows[0]?.name || ''} for ${stu.rows[0].full_name}`, existing.rows[0].grade, teacherId, studentId,
       JSON.stringify({ examId, studentId, subjectId, clear: true })]);
    return res.status(202).json({ queued: true, editRequest: rows[0] });
  }
  await query(`DELETE FROM marks WHERE exam_id = $1 AND student_id = $2 AND subject_id = $3`, [examId, studentId, subjectId]);
  res.status(204).end();
}));

// Whole-school bulk upload for one exam (admin). Columns: Admission No, Subject, Score, [Out of].
// Score may be a number or a grade label. Applies directly, even on a published exam.
// Returns scale warnings per subject, so a paper marked out of 30 but read as /100 gets caught.
marksRouter.post('/bulk', requireRole('admin'), asyncHandler(async (req, res) => {
  const { examId, csv, outOfBySubject = {} } = req.body;
  if (!examId || !csv || !csv.trim()) return res.status(400).json({ error: 'examId and csv text are required' });
  const org = req.auth.organizationId;
  const exam = await query(`SELECT id FROM exams WHERE id = $1 AND organization_id = $2`, [examId, org]);
  if (!exam.rows[0]) return res.status(404).json({ error: 'Exam not found at your school' });

  const [students, subjects] = await Promise.all([
    query(`SELECT id, school_id_number FROM students WHERE organization_id = $1`, [org]),
    query(`SELECT id, name, code FROM subjects WHERE organization_id = $1`, [org]),
  ]);
  const studentByNo = new Map(students.rows.map((s) => [s.school_id_number.toLowerCase(), s.id]));
  const subjectByKey = new Map();
  subjects.rows.forEach((s) => { subjectByKey.set(s.name.toLowerCase(), s); if (s.code) subjectByKey.set(String(s.code).toLowerCase(), s); });

  const lines = csv.trim().split(/\r?\n/).map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
  const start = /admission|school ?id/i.test(lines[0]?.[0] || '') ? 1 : 0;
  let added = 0; const skipped = []; const rawBySubject = {};

  for (let i = start; i < lines.length; i++) {
    const [no, subjName, scoreRaw, outOfRaw] = lines[i];
    const studentId = no ? studentByNo.get(no.trim().toLowerCase()) : null;
    if (!studentId) { skipped.push(`Row ${i + 1}: admission number "${no}" not found`); continue; }
    const subject = subjName ? subjectByKey.get(subjName.trim().toLowerCase()) : null;
    if (!subject) { skipped.push(`Row ${i + 1}: subject "${subjName}" not found`); continue; }
    const score = (scoreRaw || '').trim();
    const isNum = score !== '' && !Number.isNaN(Number(score.replace('%', '')));
    const outOf = Number(outOfRaw) || Number(outOfBySubject[subject.name]) || 100;
    const mark = await buildMark({ organizationId: org, studentId, subjectId: subject.id,
      score: isNum ? score : null, outOf, grade: isNum ? null : score });
    if (mark.error) { skipped.push(`Row ${i + 1}: ${mark.error}`); continue; }
    await saveMark({ examId, studentId, subjectId: subject.id, mark, enteredBy: null });
    if (isNum) (rawBySubject[subject.name] ??= []).push(Number(score.replace('%', '')));
    added++;
  }
  // Only meaningful when no explicit out-of was given: flag papers that look mis-scaled.
  const scaleWarnings = Object.entries(rawBySubject)
    .map(([subject, vals]) => ({ subject, ...scaleCheck(vals) }))
    .filter((w) => w.suspicious)
    .map((w) => ({ subject: w.subject, median: w.median, max: w.max, suggestedOutOf: w.suggestedOutOf,
      message: `${w.subject}: median ${w.median}, highest ${w.max}. Was this marked out of ${w.suggestedOutOf}? Re-upload with the correct "Out of".` }));
  res.json({ added, skipped, scaleWarnings });
}));
