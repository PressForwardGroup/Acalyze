import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { computeExamResults } from '../lib/results.js';

export const exportRouter = Router();
exportRouter.use(requireAuth, requireRole('admin'));

// Everything a school owns, as plain rows, so the browser can build an Excel
// workbook. Roster data always; marks and ranked results for one chosen exam.
exportRouter.get('/data', asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, { examId } = req.query;
  let exam = null;
  if (examId) {
    exam = (await query(`SELECT id, name, term, academic_year FROM exams WHERE id = $1 AND organization_id = $2`, [examId, org])).rows[0];
    if (!exam) return res.status(404).json({ error: 'Exam not found at your school' });
  }

  const [school, classes, subjects, teachers, students, parents] = await Promise.all([
    query(`SELECT name FROM organizations WHERE id = $1`, [org]),
    query(`SELECT c.id, c.name, c.grade, c.stream, c.grading_scheme, t.full_name AS class_teacher FROM classes c LEFT JOIN teachers t ON t.id = c.class_teacher_id WHERE c.organization_id = $1 ORDER BY c.grade, c.name`, [org]),
    query(`SELECT name, code, is_science FROM subjects WHERE organization_id = $1 ORDER BY name`, [org]),
    query(`SELECT t.full_name, t.email, t.phone, t.section,
             COALESCE(string_agg(DISTINCT c.name || ': ' || s.name, '; '), '') AS teaches
           FROM teachers t LEFT JOIN teacher_assignments ta ON ta.teacher_id = t.id
           LEFT JOIN classes c ON c.id = ta.class_id LEFT JOIN subjects s ON s.id = ta.subject_id
           WHERE t.organization_id = $1 GROUP BY t.id ORDER BY t.full_name`, [org]),
    query(`SELECT st.school_id_number, st.full_name, c.name AS class_name, st.kcpe_marks, st.status, st.enrollment_date
           FROM students st LEFT JOIN classes c ON c.id = st.class_id WHERE st.organization_id = $1 ORDER BY c.name, st.full_name`, [org]),
    query(`SELECT p.full_name, p.phone, string_agg(s.full_name, '; ') AS children
           FROM parents p LEFT JOIN parent_students ps ON ps.parent_id = p.id LEFT JOIN students s ON s.id = ps.student_id
           WHERE p.organization_id = $1 GROUP BY p.id ORDER BY p.full_name`, [org]),
  ]);

  let marks = [], results = [];
  if (exam) {
    marks = (await query(
      `SELECT st.school_id_number, st.full_name AS student, c.name AS class_name, sb.name AS subject, m.percent, m.grade, m.points
       FROM marks m JOIN students st ON st.id = m.student_id JOIN subjects sb ON sb.id = m.subject_id LEFT JOIN classes c ON c.id = st.class_id
       WHERE m.exam_id = $1 AND st.organization_id = $2 ORDER BY c.name, st.full_name, sb.name`, [examId, org])).rows;
    // Ranked results, one pass per grade (positions are across the whole grade).
    const done = new Set();
    for (const c of classes.rows) {
      const key = `${c.grade}`; if (done.has(key)) continue; done.add(key);
      const data = await computeExamResults({ organizationId: org, examId, classId: c.id });
      if (!data) continue;
      for (const r of data.rows) results.push({
        class_name: r.className, school_id_number: r.student.school_id_number, student: r.student.full_name, subjects_done: r.subjectsDone,
        total_marks: r.total == null ? null : Math.round(r.total * 10) / 10, mean: r.mean == null ? null : Math.round(r.mean * 100) / 100,
        total_points: r.totalPoints, mean_points: r.meanPoints == null ? null : Math.round(r.meanPoints * 100) / 100, grade: r.grade,
        position: r.position, out_of: r.outOf, class_position: r.classPosition, status: r.eligible ? 'Ranked' : `W: ${r.reason || 'no result'}`,
      });
    }
    results.sort((a, b) => String(a.class_name).localeCompare(String(b.class_name)) || (a.position ?? 1e9) - (b.position ?? 1e9));
  }
  res.json({ school: school.rows[0]?.name, exam, classes: classes.rows, subjects: subjects.rows, teachers: teachers.rows, students: students.rows, parents: parents.rows, marks, results });
}));
