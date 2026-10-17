import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { examAnalytics } from '../lib/analytics.js';
import { riskReport } from '../lib/risk.js';

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth, requireRole('admin'));

// Headline numbers for the school's Overview tab: counts, what needs attention,
// and which exam to show analytics for by default (the latest).
analyticsRouter.get('/overview', asyncHandler(async (req, res) => {
  const org = req.auth.organizationId;
  const [counts, pendingEdits, pendingPw, exams, byClass] = await Promise.all([
    query(`SELECT
       (SELECT count(*)::int FROM students WHERE organization_id = $1 AND status = 'active') AS students,
       (SELECT count(*)::int FROM teachers WHERE organization_id = $1) AS teachers,
       (SELECT count(*)::int FROM classes  WHERE organization_id = $1) AS classes,
       (SELECT count(*)::int FROM subjects WHERE organization_id = $1) AS subjects,
       (SELECT count(*)::int FROM parents  WHERE organization_id = $1) AS parents`, [org]),
    query(`SELECT count(*)::int AS n FROM edit_requests WHERE organization_id = $1 AND status = 'PENDING'`, [org]),
    query(`SELECT count(*)::int AS n FROM password_requests WHERE organization_id = $1 AND status = 'PENDING' AND kind IN ('parent','teacher')`, [org]),
    query(`SELECT id, name, term, academic_year, is_published, created_at FROM exams WHERE organization_id = $1 ORDER BY created_at DESC`, [org]),
    query(`SELECT c.id, c.name, c.grade,
             (SELECT count(*)::int FROM students s WHERE s.class_id = c.id AND s.status = 'active') AS students,
             (SELECT count(DISTINCT m.student_id)::int FROM marks m JOIN students s ON s.id = m.student_id
                WHERE s.class_id = c.id AND m.exam_id = (SELECT id FROM exams WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1)) AS with_marks
           FROM classes c WHERE c.organization_id = $1 ORDER BY c.grade, c.name`, [org]),
  ]);
  res.json({
    counts: counts.rows[0],
    pending: { edits: pendingEdits.rows[0].n, passwords: pendingPw.rows[0].n },
    exams: exams.rows,
    latestExam: exams.rows[0] || null,
    // Marks-entry progress per class for the latest exam: who has/hasn't been entered yet.
    entryProgress: byClass.rows,
  });
}));

// Full analytics for one exam: podium, class comparison, champions, movers, distribution.
analyticsRouter.get('/exam/:examId', asyncHandler(async (req, res) => {
  const exam = await query(`SELECT id, name, term, academic_year, is_published FROM exams WHERE id = $1 AND organization_id = $2`,
    [req.params.examId, req.auth.organizationId]);
  if (!exam.rows[0]) return res.status(404).json({ error: 'Exam not found at your school' });
  const data = await examAnalytics({ organizationId: req.auth.organizationId, examId: req.params.examId });
  res.json({ exam: exam.rows[0], ...data });
}));

// Students to watch: early-warning flags from each student's recent exams.
analyticsRouter.get('/risk', asyncHandler(async (req, res) => {
  const { examId } = req.query;
  if (!examId) return res.status(400).json({ error: 'examId is required' });
  const ok = await query(`SELECT 1 FROM exams WHERE id = $1 AND organization_id = $2`, [examId, req.auth.organizationId]);
  if (!ok.rows[0]) return res.status(404).json({ error: 'Exam not found at your school' });
  res.json(await riskReport({ organizationId: req.auth.organizationId, examId }));
}));
