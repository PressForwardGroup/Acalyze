import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const remarksRouter = Router();
remarksRouter.use(requireAuth);

remarksRouter.get('/', requireRole('teacher', 'admin'), asyncHandler(async (req, res) => {
  const { examId, classId } = req.query;
  if (!examId || !classId) return res.status(400).json({ error: 'examId and classId are required' });
  const cls = await query(`SELECT id FROM classes WHERE id = $1 AND organization_id = $2`, [classId, req.auth.organizationId]);
  if (!cls.rows[0]) return res.status(404).json({ error: 'Class not found at your school' });
  const { rows } = await query(
    `SELECT r.student_id, r.text FROM remarks r JOIN students s ON s.id = r.student_id
     WHERE r.exam_id = $1 AND s.class_id = $2 AND s.organization_id = $3`,
    [examId, classId, req.auth.organizationId]);
  res.json(rows);
}));

remarksRouter.put('/', requireRole('teacher', 'admin'), asyncHandler(async (req, res) => {
  const { examId, studentId, text } = req.body;
  if (!examId || !studentId) return res.status(400).json({ error: 'examId and studentId are required' });
  const org = req.auth.organizationId;
  const student = await query(`SELECT id FROM students WHERE id = $1 AND organization_id = $2`, [studentId, org]);
  if (!student.rows[0]) return res.status(404).json({ error: 'Student not found at your school' });
  const exam = await query(`SELECT id FROM exams WHERE id = $1 AND organization_id = $2`, [examId, org]);
  if (!exam.rows[0]) return res.status(404).json({ error: 'Exam not found at your school' });

  const trimmed = (text || '').trim();
  if (!trimmed) {
    await query(`DELETE FROM remarks WHERE exam_id = $1 AND student_id = $2`, [examId, studentId]);
    return res.json({ deleted: true });
  }
  const teacherId = req.auth.role === 'teacher' ? req.auth.sub : null;
  const { rows } = await query(
    `INSERT INTO remarks (exam_id, student_id, text, teacher_id) VALUES ($1,$2,$3,$4)
     ON CONFLICT (exam_id, student_id) DO UPDATE SET text = $3, teacher_id = $4, updated_at = now() RETURNING *`,
    [examId, studentId, trimmed, teacherId]);
  res.json(rows[0]);
}));
