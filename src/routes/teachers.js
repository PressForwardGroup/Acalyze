import { Router } from 'express';
import { query } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { scope, resolveCenter } from '../lib/scope.js';

export const teachersRouter = Router();
teachersRouter.use(requireAuth);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Is this email already used by any login (teacher, school admin or platform admin)?
async function emailInUse(email, exceptTeacherId = null) {
  const { rows } = await query(
    `SELECT 1 FROM teachers WHERE lower(email) = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)
     UNION SELECT 1 FROM admins WHERE lower(email) = $1
     UNION SELECT 1 FROM platform_admins WHERE lower(email) = $1`,
    [email, exceptTeacherId]
  );
  return !!rows[0];
}

// pairs = [{ classId, subjectId }]. Saves exact pairs, then keeps the older
// class_teachers / teacher_subjects tables in sync so other pages keep working.
async function setAssignments(teacherId, orgId, pairs) {
  await query(`DELETE FROM teacher_assignments WHERE teacher_id = $1`, [teacherId]);
  for (const p of pairs) {
    if (!p.classId || !p.subjectId) continue;
    await query(
      `INSERT INTO teacher_assignments (teacher_id, class_id, subject_id)
       SELECT $1, c.id, s.id FROM classes c, subjects s
       WHERE c.id = $2 AND s.id = $3 AND c.organization_id = $4 AND s.organization_id = $4
       ON CONFLICT DO NOTHING`,
      [teacherId, p.classId, p.subjectId, orgId]);
  }
  await query(`DELETE FROM class_teachers WHERE teacher_id = $1`, [teacherId]);
  await query(`DELETE FROM teacher_subjects WHERE teacher_id = $1`, [teacherId]);
  await query(`INSERT INTO class_teachers (class_id, teacher_id)
               SELECT DISTINCT class_id, teacher_id FROM teacher_assignments WHERE teacher_id = $1
               ON CONFLICT DO NOTHING`, [teacherId]);
  await query(`INSERT INTO teacher_subjects (teacher_id, subject_id)
               SELECT DISTINCT teacher_id, subject_id FROM teacher_assignments WHERE teacher_id = $1
               ON CONFLICT DO NOTHING`, [teacherId]);
}

teachersRouter.get('/', requireRole('admin', 'teacher'), asyncHandler(async (req, res) => {
  const sc = scope(req, { alias: 't' });
  const { rows } = await query(
    `SELECT t.id, t.center_id, t.full_name, t.phone, t.bio, t.section, t.created_at,
       t.email, t.must_change_password,
       COALESCE(json_agg(DISTINCT c.id) FILTER (WHERE c.id IS NOT NULL), '[]') AS class_ids,
       COALESCE(json_agg(DISTINCT s.id) FILTER (WHERE s.id IS NOT NULL), '[]') AS subject_ids,
       COALESCE((SELECT json_agg(json_build_object('class_id', ta.class_id, 'subject_id', ta.subject_id))
                 FROM teacher_assignments ta WHERE ta.teacher_id = t.id), '[]') AS assignments
     FROM teachers t
     LEFT JOIN class_teachers ct ON ct.teacher_id = t.id
     LEFT JOIN classes c ON c.id = ct.class_id
     LEFT JOIN teacher_subjects ts ON ts.teacher_id = t.id
     LEFT JOIN subjects s ON s.id = ts.subject_id
     WHERE ${sc.sql}
     GROUP BY t.id
     ORDER BY t.full_name`,
    sc.params
  );
  res.json(rows);
}));

teachersRouter.post('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const { fullName, phone, bio, section, password, centerId } = req.body;
  const email = (req.body.email || '').trim().toLowerCase();
  let pairs = Array.isArray(req.body.assignments) ? req.body.assignments : [];
  if (!pairs.length && req.body.classId && req.body.subjectId) {
    pairs = [{ classId: req.body.classId, subjectId: req.body.subjectId }];
  }
  if (!fullName || !section) return res.status(400).json({ error: 'Full name and section are required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email for this teacher — it is their login.' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'The default password must be at least 6 characters.' });

  const center = await resolveCenter(req, centerId);
  if (!center) return res.status(400).json({ error: 'Choose which campus this teacher is at (centerId).' });
  const dupe = await query(
    `SELECT id FROM teachers WHERE organization_id = $1 AND lower(full_name) = lower($2)`,
    [req.auth.organizationId, fullName.trim()]);
  if (dupe.rows[0]) {
    return res.status(409).json({ error: `${fullName.trim()} is already added — use Edit to change their classes, subjects or email.` });
  }
  if (await emailInUse(email)) return res.status(409).json({ error: `${email} is already used by another login.` });

  const { rows } = await query(
    `INSERT INTO teachers (organization_id, center_id, full_name, phone, bio, section, email, password_hash, must_change_password)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
     RETURNING id, center_id, full_name, phone, bio, section, email, must_change_password`,
    [req.auth.organizationId, center, fullName.trim(), phone || null, bio || null, section, email, await hashPassword(password)]
  );
  await setAssignments(rows[0].id, req.auth.organizationId, pairs);
  res.status(201).json(rows[0]);
}));

// Change which class + subject pairs an existing teacher has.
teachersRouter.put('/:id/assignments', requireRole('admin'), asyncHandler(async (req, res) => {
  const pairs = Array.isArray(req.body.assignments) ? req.body.assignments : [];
  const t = await query(`SELECT id FROM teachers WHERE id = $1 AND organization_id = $2`, [req.params.id, req.auth.organizationId]);
  if (!t.rows[0]) return res.status(404).json({ error: 'Teacher not found' });
  await setAssignments(req.params.id, req.auth.organizationId, pairs);
  res.json({ ok: true });
}));

// Admin sets a new temporary password; the teacher must change it at next sign-in.
teachersRouter.post('/:id/reset-password', requireRole('admin'), asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  const { rowCount } = await query(
    `UPDATE teachers SET password_hash = $1, must_change_password = true WHERE id = $2 AND organization_id = $3`,
    [await hashPassword(password), req.params.id, req.auth.organizationId]);
  if (!rowCount) return res.status(404).json({ error: 'Teacher not found' });
  res.json({ ok: true });
}));

// Bulk add via CSV — columns: Full Name, Section, Class, Subject, Phone.
// Teachers added this way have no login until you give them an email + password in Edit.
teachersRouter.post('/bulk', requireRole('admin'), asyncHandler(async (req, res) => {
  const { csv } = req.body;
  if (!csv || !csv.trim()) return res.status(400).json({ error: 'csv text is required' });

  const [classes, subjects] = await Promise.all([
    query(`SELECT id, name FROM classes WHERE organization_id = $1`, [req.auth.organizationId]),
    query(`SELECT id, name FROM subjects WHERE organization_id = $1`, [req.auth.organizationId]),
  ]);
  const bulkCenter = await resolveCenter(req, null);
  if (!bulkCenter) return res.status(400).json({ error: 'Your school has more than one campus: add teachers one at a time, or set the campus first.' });
  const classByName = new Map(classes.rows.map(c => [c.name.toLowerCase(), c.id]));
  const subjectByName = new Map(subjects.rows.map(s => [s.name.toLowerCase(), s.id]));

  const lines = csv.trim().split(/\r?\n/).map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
  const start = /name/i.test(lines[0]?.[0] || '') ? 1 : 0;
  let added = 0;
  const skipped = [];
  const teacherIdByName = new Map();

  for (let i = start; i < lines.length; i++) {
    const [name, sectionRaw, className, subjectName, phone] = lines[i];
    if (!name) { skipped.push(`Row ${i + 1}: missing teacher name`); continue; }
    const section = (sectionRaw || '').trim().toUpperCase();
    if (!['PRIMARY', 'JUNIOR', 'SENIOR'].includes(section)) {
      skipped.push(`Row ${i + 1}: section must be PRIMARY, JUNIOR or SENIOR (got "${sectionRaw}")`); continue;
    }
    let teacherId = teacherIdByName.get(name.toLowerCase());
    if (!teacherId) {
      const existing = await query(`SELECT id FROM teachers WHERE organization_id = $1 AND lower(full_name) = lower($2)`, [req.auth.organizationId, name.trim()]);
      if (existing.rows[0]) {
        teacherId = existing.rows[0].id;
      } else {
        const { rows } = await query(
          `INSERT INTO teachers (organization_id, center_id, full_name, phone, section) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [req.auth.organizationId, bulkCenter, name.trim(), (phone || '').trim() || null, section]
        );
        teacherId = rows[0].id;
        added++;
      }
      teacherIdByName.set(name.toLowerCase(), teacherId);
    }
    const classId = className ? classByName.get(className.trim().toLowerCase()) : null;
    if (className && !classId) skipped.push(`Row ${i + 1}: class "${className}" not found`);
    if (classId) await query(`INSERT INTO class_teachers (class_id, teacher_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [classId, teacherId]);
    const subjectId = subjectName ? subjectByName.get(subjectName.trim().toLowerCase()) : null;
    if (subjectName && !subjectId) skipped.push(`Row ${i + 1}: subject "${subjectName}" not found`);
    if (subjectId) await query(`INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [teacherId, subjectId]);
    if (classId && subjectId) await query(`INSERT INTO teacher_assignments (teacher_id, class_id, subject_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [teacherId, classId, subjectId]);
  }
  res.json({ added, skipped });
}));

teachersRouter.patch('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { fullName, phone, bio } = req.body;
  const email = req.body.email ? req.body.email.trim().toLowerCase() : null;
  if (email) {
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'That email address is not valid.' });
    if (await emailInUse(email, req.params.id)) return res.status(409).json({ error: `${email} is already used by another login.` });
  }
  const { rows } = await query(
    `UPDATE teachers SET full_name = COALESCE($1, full_name), phone = $2, bio = $3, email = COALESCE($6, email)
     WHERE id = $4 AND organization_id = $5
     RETURNING id, center_id, full_name, phone, bio, section, email, must_change_password`,
    [fullName || null, phone || null, bio || null, req.params.id, req.auth.organizationId, email]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Teacher not found' });
  res.json(rows[0]);
}));

teachersRouter.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const { rowCount } = await query(`DELETE FROM teachers WHERE id = $1 AND organization_id = $2`, [req.params.id, req.auth.organizationId]);
  if (!rowCount) return res.status(404).json({ error: 'Teacher not found' });
  res.status(204).end();
}));
