import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireFeature } from '../lib/plans.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { STATUSES, validDay, today, daysAgo, rate, summarize } from '../lib/attendance.js';

export const attendanceRouter = Router();
attendanceRouter.use(requireAuth, requireFeature('attendance'));

// Admins may record for any class at their school. Teachers only for classes they are
// class teacher of, or teach.
async function classAllowed(req, classId) {
  const org = req.auth.organizationId;
  const c = await query(`SELECT id, name FROM classes WHERE id = $1 AND organization_id = $2`, [classId, org]);
  if (!c.rows[0]) return null;
  if (req.auth.role === 'admin') return c.rows[0];
  const t = await query(
    `SELECT 1 FROM classes c WHERE c.id = $1 AND (c.class_teacher_id = $2 OR EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id = $2 AND ta.class_id = c.id))`,
    [classId, req.auth.sub]);
  return t.rows[0] ? c.rows[0] : null;
}

// The register for one class on one day.
attendanceRouter.get('/class', requireRole('admin', 'teacher'), asyncHandler(async (req, res) => {
  const day = validDay(req.query.day || today());
  if (!day) return res.status(400).json({ error: 'Choose a valid date.' });
  if (!req.query.classId || !(await classAllowed(req, req.query.classId))) return res.status(403).json({ error: 'You can only take the register for your own classes.' });
  const { rows } = await query(
    `SELECT s.id AS student_id, s.full_name, s.school_id_number, a.status
     FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.day = $3::date
     WHERE s.class_id = $1 AND s.organization_id = $2 AND s.status = 'active' ORDER BY s.full_name`,
    [req.query.classId, req.auth.organizationId, day]);
  res.json({ day, rows });
}));

// Save a whole register. Body: { classId, day, records:[{ studentId, status }] }
attendanceRouter.put('/class', requireRole('admin', 'teacher'), asyncHandler(async (req, res) => {
  const { classId, records } = req.body;
  const day = validDay(req.body.day || today());
  if (!day) return res.status(400).json({ error: 'Choose a valid date.' });
  if (!Array.isArray(records) || !records.length) return res.status(400).json({ error: 'Nothing to save.' });
  if (!classId || !(await classAllowed(req, classId))) return res.status(403).json({ error: 'You can only take the register for your own classes.' });
  const clean = records.filter((r) => r && r.studentId && STATUSES.includes(r.status));
  if (!clean.length) return res.status(400).json({ error: 'No valid attendance marks were sent.' });
  // Only students who really belong to this class at this school are written.
  const valid = await query(`SELECT id FROM students WHERE class_id = $1 AND organization_id = $2 AND id = ANY($3::uuid[])`, [classId, req.auth.organizationId, clean.map((r) => r.studentId)]);
  const ok = new Set(valid.rows.map((r) => r.id)), use = clean.filter((r) => ok.has(r.studentId));
  if (!use.length) return res.status(400).json({ error: 'None of those students are in this class.' });
  await query(
    `INSERT INTO attendance (organization_id, student_id, class_id, day, status, recorded_by_id)
     SELECT $1::uuid, t.s, $2::uuid, $3::date, t.st, $4::uuid FROM unnest($5::uuid[], $6::text[]) AS t(s, st)
     ON CONFLICT (student_id, day) DO UPDATE SET status = EXCLUDED.status, class_id = EXCLUDED.class_id, recorded_by_id = EXCLUDED.recorded_by_id`,
    [req.auth.organizationId, classId, day, req.auth.role === 'teacher' ? req.auth.sub : null, use.map((r) => r.studentId), use.map((r) => r.status)]);
  res.json({ saved: use.length, skipped: clean.length - use.length });
}));

// School-wide picture for the admin: rate per class and the students missing the most days.
attendanceRouter.get('/summary', requireRole('admin'), asyncHandler(async (req, res) => {
  const to = validDay(req.query.to) || today(), from = validDay(req.query.from) || daysAgo(30);
  const org = req.auth.organizationId;
  const [byClass, frequent] = await Promise.all([
    query(`SELECT c.id, c.name, count(a.id)::int AS total,
             count(*) FILTER (WHERE a.status = 'present')::int AS present, count(*) FILTER (WHERE a.status = 'late')::int AS late,
             count(*) FILTER (WHERE a.status = 'absent')::int AS absent, count(*) FILTER (WHERE a.status = 'excused')::int AS excused
           FROM classes c LEFT JOIN attendance a ON a.class_id = c.id AND a.day BETWEEN $2::date AND $3::date
           WHERE c.organization_id = $1 GROUP BY c.id, c.name ORDER BY c.name`, [org, from, to]),
    query(`SELECT s.id, s.full_name, s.school_id_number, c.name AS class_name,
             count(*) FILTER (WHERE a.status = 'absent')::int AS absent, count(*) FILTER (WHERE a.status = 'late')::int AS late, count(*)::int AS total
           FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN classes c ON c.id = s.class_id
           WHERE a.organization_id = $1 AND a.day BETWEEN $2::date AND $3::date
           GROUP BY s.id, c.name HAVING count(*) FILTER (WHERE a.status = 'absent') >= 3 ORDER BY absent DESC, late DESC LIMIT 20`, [org, from, to]),
  ]);
  const classes = byClass.rows.map((c) => ({ ...c, rate: rate(c) }));
  const all = classes.reduce((a, c) => ({ present: a.present + c.present, late: a.late + c.late, absent: a.absent + c.absent, excused: a.excused + c.excused }), { present: 0, late: 0, absent: 0, excused: 0 });
  res.json({ from, to, overallRate: rate(all), counts: all, classes, frequentAbsentees: frequent.rows });
}));

// A parent sees only their own child's record.
attendanceRouter.get('/mine', requireRole('parent'), asyncHandler(async (req, res) => {
  const { studentId } = req.query;
  const own = await query(`SELECT 1 FROM parent_students ps JOIN students s ON s.id = ps.student_id WHERE ps.parent_id = $1 AND ps.student_id = $2 AND s.organization_id = $3`, [req.auth.sub, studentId, req.auth.organizationId]);
  if (!own.rows[0]) return res.status(403).json({ error: "You can only view your own child's attendance" });
  const { rows } = await query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, status FROM attendance WHERE student_id = $1 AND organization_id = $2 AND day >= $3::date ORDER BY day DESC`,
    [studentId, req.auth.organizationId, daysAgo(90)]);
  res.json({ summary: summarize(rows), recent: rows.filter((r) => r.status !== 'present').slice(0, 15), days: 90 });
}));
