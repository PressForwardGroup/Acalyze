import { query } from './db.js';
import { gradeFor, isValidGrade } from './grading.js';
import { formLevelOf } from './scope.js';

// Turns what a teacher typed into a stored mark: { grade, points, percent }.
//   score + outOf  -> percent = score/outOf*100, graded by the CLASS's scheme
//   grade (direct) -> CBC level or 8-4-4 letter, stored without a percent
// Returns { error } on anything invalid, so every caller (single entry, bulk
// CSV, approval of an edit request) validates identically.
export async function buildMark({ organizationId, studentId, subjectId, score, outOf, grade }) {
  const ctx = await query(
    `SELECT c.grading_scheme AS scheme, c.grade AS class_grade, s.is_science
     FROM students st
     JOIN classes c ON c.id = st.class_id
     JOIN subjects s ON s.id = $3 AND s.organization_id = $1
     WHERE st.id = $2 AND st.organization_id = $1`,
    [organizationId, studentId, subjectId]);
  const c = ctx.rows[0];
  if (!c) return { error: 'Student must be in a class, and the subject must belong to your school.' };
  const opts = { isScience: c.is_science, formLevel: formLevelOf(c.class_grade) };

  if (score != null && score !== '') {
    const max = Number(outOf) > 0 ? Number(outOf) : 100;
    const raw = Number(String(score).replace('%', ''));
    if (Number.isNaN(raw) || raw < 0 || raw > max) return { error: `Score must be between 0 and ${max}.` };
    const percent = Math.round((raw / max) * 10000) / 100;
    const g = gradeFor(c.scheme, percent, opts);
    return { grade: g.grade, points: g.points, percent, scheme: c.scheme };
  }
  const label = String(grade || '').toUpperCase();
  if (!label || !isValidGrade(c.scheme, label)) {
    return { error: `Enter a score, or a valid ${c.scheme === 'cbc' ? 'CBC level (EE1 to BE2)' : '8-4-4 grade (A to E)'}.` };
  }
  const idx = (c.scheme === 'cbc'
    ? ['BE2', 'BE1', 'AE2', 'AE1', 'ME2', 'ME1', 'EE2', 'EE1']
    : ['E', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A']).indexOf(label);
  return { grade: label, points: idx + 1, percent: null, scheme: c.scheme };
}

export async function saveMark({ examId, studentId, subjectId, mark, enteredBy }) {
  const { rows } = await query(
    `INSERT INTO marks (exam_id, student_id, subject_id, grade, points, percent, entered_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (exam_id, student_id, subject_id)
     DO UPDATE SET grade = $4, points = $5, percent = $6, entered_by_id = $7, updated_at = now()
     RETURNING *`,
    [examId, studentId, subjectId, mark.grade, mark.points, mark.percent, enteredBy || null]);
  return rows[0];
}
