import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { computeExamResults, computeStudentCard } from '../lib/results.js';
import { remarkFor } from '../lib/grading.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const reportCardRouter = Router();
reportCardRouter.use(requireAuth);

// One shape for every consumer (the Classic printed form, the Modern
// on-screen card, the parent view), so the template is purely presentation.
async function shapeCards({ organizationId, data, rows }) {
  const [org, mains, teacher] = await Promise.all([
    query(`SELECT name, motto, logo_url, report_card_template FROM organizations WHERE id = $1`, [organizationId]),
    query(`SELECT subject_id FROM main_subjects WHERE organization_id = $1`, [organizationId]),
    data.class.class_teacher_id
      ? query(`SELECT full_name, phone FROM teachers WHERE id = $1`, [data.class.class_teacher_id]) : { rows: [] },
  ]);
  const mainIds = new Set(mains.rows.map((m) => m.subject_id));
  const topPts = data.scheme === 'cbc' ? 8 : 12;

  return rows.map((row) => {
    const byId = Object.fromEntries(row.marks.map((m) => [m.subjectId, m]));
    const lines = data.subjects.map((sub) => {
      const m = byId[sub.id];
      return {
        subjectId: sub.id, name: sub.name, code: sub.code, isMain: mainIds.has(sub.id),
        taken: !!m, percent: m?.percent ?? null, grade: m?.grade ?? null, points: m?.points ?? null,
        position: m?.position ?? null, remark: m?.remark ?? null, isCounted: m?.isCounted ?? null,
      };
    });
    // 8-4-4 target tracking: KCPE marks out of 500 -> expected average %.
    const target = data.scheme === '844' && row.student.kcpe_marks ? row.student.kcpe_marks / 5 : null;
    return {
      template: org.rows[0].report_card_template,
      school: { name: org.rows[0].name, motto: org.rows[0].motto, logoUrl: org.rows[0].logo_url },
      scheme: data.scheme,
      student: { id: row.student.id, name: row.student.full_name, admissionNo: row.student.school_id_number,
                 className: row.className, kcpeMarks: row.student.kcpe_marks },
      lines,
      summary: {
        eligible: row.eligible, reason: row.reason,
        subjectsDone: row.subjectsDone,
        total: row.total, mean: row.mean, totalPoints: row.totalPoints, meanPoints: row.meanPoints,
        grade: row.grade, remark: row.remark || (row.meanPoints != null ? remarkFor(data.scheme, Math.round(row.meanPoints) - 1) : null),
        position: row.position, outOf: row.outOf, classPosition: row.classPosition, classOutOf: row.classOutOf,
        topPoints: topPts,
        target: target == null || row.mean == null ? null : { value: Math.round(target * 10) / 10, met: row.mean >= target },
      },
      teacherComment: row.remarkText,
      classTeacher: teacher.rows[0] ? { name: teacher.rows[0].full_name, phone: teacher.rows[0].phone } : null,
    };
  });
}

// A parent may only open a child linked to their own account.
async function parentOwns(req, studentId) {
  const { rows } = await query(
    `SELECT 1 FROM parent_students ps JOIN students s ON s.id = ps.student_id
     WHERE ps.parent_id = $1 AND ps.student_id = $2 AND s.organization_id = $3`,
    [req.auth.sub, studentId, req.auth.organizationId]);
  return !!rows[0];
}

// ---------- Batch: every card for a class, or a whole grade, for printing ----------
// GET /report-card/batch?examId=&classId=&scope=class|grade
reportCardRouter.get('/batch', requireRole('admin', 'teacher'), asyncHandler(async (req, res) => {
  const { examId, classId, scope: sc = 'class' } = req.query;
  if (!examId || !classId) return res.status(400).json({ error: 'examId and classId are required' });
  const org = req.auth.organizationId;
  const exam = await query(`SELECT id, name, term, academic_year, newsletter FROM exams WHERE id = $1 AND organization_id = $2`, [examId, org]);
  if (!exam.rows[0]) return res.status(404).json({ error: 'Exam not found at your school' });
  const data = await computeExamResults({ organizationId: org, examId, classId });
  if (!data) return res.status(404).json({ error: 'Class not found at your school' });
  const rows = (sc === 'grade' ? data.rows : data.rows.filter((r) => r.classId === classId))
    .sort((a, b) => a.className.localeCompare(b.className) || a.student.full_name.localeCompare(b.student.full_name));
  res.json({ exam: exam.rows[0], cards: await shapeCards({ organizationId: org, data, rows }) });
}));

// ---------- One student's card ----------
reportCardRouter.get('/:studentId', requireRole('admin', 'teacher', 'parent'), asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const { examId } = req.query;
  if (!examId) return res.status(400).json({ error: 'examId is required' });
  const org = req.auth.organizationId;
  if (req.auth.role === 'parent' && !(await parentOwns(req, studentId))) {
    return res.status(403).json({ error: 'You can only view your own child\'s report card' });
  }
  const exam = await query(`SELECT * FROM exams WHERE id = $1 AND organization_id = $2`, [examId, org]);
  if (!exam.rows[0]) return res.status(404).json({ error: 'Exam not found' });
  if (!exam.rows[0].is_published && req.auth.role === 'parent') {
    return res.status(403).json({ error: 'This exam has not been published yet' });
  }
  const data = await computeStudentCard({ organizationId: org, studentId, examId });
  if (!data) return res.status(404).json({ error: 'Student not found, or not in a class yet' });
  const [card] = await shapeCards({ organizationId: org, data, rows: [data.row] });
  res.json({ exam: exam.rows[0], card });
}));

// ---------- Term-over-term trend ----------
reportCardRouter.get('/:studentId/trend', requireRole('admin', 'teacher', 'parent'), asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const org = req.auth.organizationId;
  if (req.auth.role === 'parent' && !(await parentOwns(req, studentId))) {
    return res.status(403).json({ error: "You can only view your own child's trend" });
  }
  const exams = await query(
    `SELECT id, name, term, academic_year FROM exams WHERE organization_id = $1 ${req.auth.role === 'parent' ? 'AND is_published = true' : ''}
     ORDER BY created_at`, [org]);
  const trend = [];
  for (const exam of exams.rows) {
    const data = await computeStudentCard({ organizationId: org, studentId, examId: exam.id });
    if (data?.row?.meanPoints != null) {
      const r = data.row;
      trend.push({ exam: { id: exam.id, name: exam.name, term: exam.term }, mean: r.mean, meanPoints: r.meanPoints,
                   grade: r.grade, position: r.position, outOf: r.outOf, eligible: r.eligible });
    }
  }
  res.json(trend);
}));
