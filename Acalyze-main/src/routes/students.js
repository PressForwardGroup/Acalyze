import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { scope, resolveCenter } from '../lib/scope.js';
import { linkParent } from '../lib/parents.js';

export const studentsRouter = Router();
studentsRouter.use(requireAuth);

// Full roster incl. parent contact — admin/teacher only. Parents never call this.
studentsRouter.get('/', requireRole('admin', 'teacher'), asyncHandler(async (req, res) => {
  const s = scope(req, { alias: 's' });
  const { rows } = await query(
    `SELECT s.id, s.school_id_number, s.full_name, s.class_id, s.center_id, s.status, s.kcpe_marks,
            COALESCE(json_agg(json_build_object('id', p.id, 'name', p.full_name, 'phone', p.phone))
                     FILTER (WHERE p.id IS NOT NULL), '[]') AS parents
     FROM students s
     LEFT JOIN parent_students ps ON ps.student_id = s.id
     LEFT JOIN parents p ON p.id = ps.parent_id
     WHERE ${s.sql} GROUP BY s.id ORDER BY s.full_name`, s.params);
  res.json(rows);
}));

// A parent sees ONLY their own linked children. The parent id comes from
// their verified token, never from a URL param, so there is nothing to guess.
studentsRouter.get('/mine', requireRole('parent'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT s.id, s.school_id_number, s.full_name, s.class_id, c.name AS class_name, c.grading_scheme
     FROM parent_students ps
     JOIN students s ON s.id = ps.student_id
     LEFT JOIN classes c ON c.id = s.class_id
     WHERE ps.parent_id = $1 AND s.organization_id = $2 AND s.status = 'active'
     ORDER BY s.full_name`, [req.auth.sub, req.auth.organizationId]);
  res.json(rows);
}));

studentsRouter.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const { schoolIdNumber, fullName, classId, parentName, parentPhone, centerId, kcpeMarks } = req.body;
  if (!schoolIdNumber || !fullName) return res.status(400).json({ error: 'schoolIdNumber and fullName are required' });
  const org = req.auth.organizationId;

  // Unique within THIS school only — two unrelated schools can reuse the same number.
  const dupe = await query(`SELECT id FROM students WHERE organization_id = $1 AND school_id_number = $2`, [org, schoolIdNumber.trim()]);
  if (dupe.rows[0]) return res.status(409).json({ error: `Admission number "${schoolIdNumber}" is already in use at your school` });

  let center = null;
  if (classId) {
    const cls = await query(`SELECT id, center_id FROM classes WHERE id = $1 AND organization_id = $2`, [classId, org]);
    if (!cls.rows[0]) return res.status(404).json({ error: 'Class not found at your school' });
    center = cls.rows[0].center_id;
  } else center = await resolveCenter(req, centerId);
  if (!center) return res.status(400).json({ error: 'Choose a class or campus (centerId) for this student.' });

  const { rows } = await query(
    `INSERT INTO students (organization_id, center_id, school_id_number, full_name, class_id, kcpe_marks)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, school_id_number, full_name, class_id`,
    [org, center, schoolIdNumber.trim(), fullName.trim(), classId || null, kcpeMarks || null]);
  const newParent = await linkParent({ organizationId: org, studentId: rows[0].id, parentName, parentPhone });
  res.status(201).json({ ...rows[0], newParentLogin: newParent });
}));

// Bulk CSV — Full Name, Admission No, Class, Parent Name, Parent Phone.
// Returns the temporary passwords for any NEW parent accounts so the admin
// can hand them out (shown once, never stored in plain text).
studentsRouter.post('/bulk', requireRole('admin'), asyncHandler(async (req, res) => {
  const { csv } = req.body;
  if (!csv || !csv.trim()) return res.status(400).json({ error: 'csv text is required' });
  const org = req.auth.organizationId;
  const classes = await query(`SELECT id, name, center_id FROM classes WHERE organization_id = $1`, [org]);
  const classByName = new Map(classes.rows.map((c) => [c.name.toLowerCase(), c]));
  const fallbackCenter = await resolveCenter(req, null);

  const lines = csv.trim().split(/\r?\n/).map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
  const start = /name/i.test(lines[0]?.[0] || '') ? 1 : 0;
  let added = 0; const skipped = []; const parentLogins = [];

  for (let i = start; i < lines.length; i++) {
    const [name, idRaw, className, parentName, parentPhone] = lines[i];
    const schoolId = (idRaw || '').trim();
    if (!name || !schoolId) { skipped.push(`Row ${i + 1}: missing name or admission number`); continue; }
    const dupe = await query(`SELECT id FROM students WHERE organization_id = $1 AND school_id_number = $2`, [org, schoolId]);
    if (dupe.rows[0]) { skipped.push(`Row ${i + 1}: admission number "${schoolId}" already in use`); continue; }
    const cls = className ? classByName.get(className.trim().toLowerCase()) : null;
    if (className && !cls) skipped.push(`Row ${i + 1}: class "${className}" not found, added with no class`);
    const center = cls?.center_id || fallbackCenter;
    if (!center) { skipped.push(`Row ${i + 1}: no campus to place this student in`); continue; }
    const ins = await query(
      `INSERT INTO students (organization_id, center_id, school_id_number, full_name, class_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [org, center, schoolId, name.trim(), cls?.id || null]);
    const np = await linkParent({ organizationId: org, studentId: ins.rows[0].id, parentName, parentPhone });
    if (np) parentLogins.push({ ...np, student: name.trim() });
    added++;
  }
  res.json({ added, skipped, parentLogins });
}));

// Name / admission-number changes go through /edit-requests (approval workflow).
// This only allows class and KCPE marks.
studentsRouter.patch('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { classId, kcpeMarks } = req.body;
  if (classId) {
    const cls = await query(`SELECT id FROM classes WHERE id = $1 AND organization_id = $2`, [classId, req.auth.organizationId]);
    if (!cls.rows[0]) return res.status(404).json({ error: 'Class not found at your school' });
  }
  const { rows } = await query(
    `UPDATE students SET class_id = COALESCE($1, class_id), kcpe_marks = COALESCE($2, kcpe_marks)
     WHERE id = $3 AND organization_id = $4 RETURNING id, school_id_number, full_name, class_id, kcpe_marks`,
    [classId || null, kcpeMarks ?? null, req.params.id, req.auth.organizationId]);
  if (!rows[0]) return res.status(404).json({ error: 'Student not found' });
  res.json(rows[0]);
}));

studentsRouter.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rowCount } = await query(`DELETE FROM students WHERE id = $1 AND organization_id = $2`, [req.params.id, req.auth.organizationId]);
  if (!rowCount) return res.status(404).json({ error: 'Student not found' });
  res.status(204).end();
}));
