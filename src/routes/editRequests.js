import { Router } from 'express';
import { query, pool } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { buildMark } from '../lib/marks.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const editRequestsRouter = Router();
editRequestsRouter.use(requireAuth);

// A name or admission-number change — queued for approval, never applied directly.
editRequestsRouter.post('/student-edit', requireRole('admin'), asyncHandler(async (req, res) => {
  const { studentId, field, newValue } = req.body; // field: 'name' | 'schoolId'
  if (!studentId || !field || !newValue) return res.status(400).json({ error: 'studentId, field and newValue are required' });
  if (!['name', 'schoolId'].includes(field)) return res.status(400).json({ error: 'field must be "name" or "schoolId"' });
  const org = req.auth.organizationId;

  const student = await query(`SELECT id, full_name, school_id_number FROM students WHERE id = $1 AND organization_id = $2`, [studentId, org]);
  if (!student.rows[0]) return res.status(404).json({ error: 'Student not found' });

  if (field === 'schoolId') {
    const dupe = await query(`SELECT id FROM students WHERE organization_id = $1 AND school_id_number = $2 AND id != $3`, [org, newValue.trim(), studentId]);
    if (dupe.rows[0]) return res.status(409).json({ error: `Admission number "${newValue}" is already in use at your school` });
  }
  const type = field === 'name' ? 'STUDENT_NAME' : 'STUDENT_ID';
  const oldValue = field === 'name' ? student.rows[0].full_name : student.rows[0].school_id_number;
  const label = `${field === 'name' ? 'Name' : 'Admission no.'}: ${student.rows[0].full_name}`;
  const { rows } = await query(
    `INSERT INTO edit_requests (organization_id, type, label, old_value, new_value, student_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [org, type, label, oldValue, newValue.trim(), studentId]);
  res.status(201).json(rows[0]);
}));

editRequestsRouter.get('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const { status } = req.query;
  const { rows } = await query(
    `SELECT * FROM edit_requests WHERE organization_id = $1 ${status ? 'AND status = $2' : ''} ORDER BY requested_at DESC`,
    status ? [req.auth.organizationId, status.toUpperCase()] : [req.auth.organizationId]);
  res.json(rows);
}));

editRequestsRouter.post('/:id/approve', requireRole('admin'), asyncHandler(async (req, res) => {
  const org = req.auth.organizationId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM edit_requests WHERE id = $1 AND organization_id = $2 AND status = 'PENDING' FOR UPDATE`, [req.params.id, org]);
    const r = rows[0];
    if (!r) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pending request not found' }); }

    if (r.type === 'STUDENT_NAME') {
      await client.query(`UPDATE students SET full_name = $1 WHERE id = $2 AND organization_id = $3`, [r.new_value, r.student_id, org]);
    } else if (r.type === 'STUDENT_ID') {
      await client.query(`UPDATE students SET school_id_number = $1 WHERE id = $2 AND organization_id = $3`, [r.new_value, r.student_id, org]);
    } else if (r.type === 'MARK') {
      const x = r.extra_json;
      if (x.clear) {
        await client.query(`DELETE FROM marks WHERE exam_id = $1 AND student_id = $2 AND subject_id = $3`, [x.examId, x.studentId, x.subjectId]);
      } else {
        // Re-grade from the original entry, so approval applies exactly what the teacher typed.
        const mark = await buildMark({ organizationId: org, studentId: x.studentId, subjectId: x.subjectId, score: x.score, outOf: x.outOf, grade: x.grade });
        if (mark.error) { await client.query('ROLLBACK'); return res.status(400).json({ error: mark.error }); }
        await client.query(
          `INSERT INTO marks (exam_id, student_id, subject_id, grade, points, percent, entered_by_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (exam_id, student_id, subject_id)
           DO UPDATE SET grade = $4, points = $5, percent = $6, updated_at = now()`,
          [x.examId, x.studentId, x.subjectId, mark.grade, mark.points, mark.percent, r.requested_by_teacher_id]);
      }
    }
    await client.query(`UPDATE edit_requests SET status = 'APPROVED', resolved_by_admin_id = $1, resolved_at = now() WHERE id = $2`, [req.auth.actingAsPlatformAdmin ? null : req.auth.sub, r.id]);
    await client.query('COMMIT');
    res.json({ approved: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

editRequestsRouter.post('/:id/reject', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE edit_requests SET status = 'REJECTED', resolved_by_admin_id = $1, resolved_at = now()
     WHERE id = $2 AND organization_id = $3 AND status = 'PENDING' RETURNING *`,
    [req.auth.actingAsPlatformAdmin ? null : req.auth.sub, req.params.id, req.auth.organizationId]);
  if (!rows[0]) return res.status(404).json({ error: 'Pending request not found' });
  res.json({ rejected: true });
}));
