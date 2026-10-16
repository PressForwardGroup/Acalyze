import { query } from './db.js';
import { computeStudentResult, remarkFor } from './grading.js';
import { formLevelOf } from './scope.js';

// Competition ranking: equal scores share a position, next position skips
// (1, 2, 2, 4) — the same tie handling the Gradebook Analyzer used.
function rank(items, keyFn) {
  const sorted = [...items].sort((a, b) => keyFn(b) - keyFn(a));
  const out = new Map();
  sorted.forEach((it, i) => {
    out.set(it, i > 0 && keyFn(it) === keyFn(sorted[i - 1]) ? out.get(sorted[i - 1]) : i + 1);
  });
  return out;
}

// THE single source of truth for results. Admin dashboards, printed report
// cards and the parent view all read from this, so they can never disagree.
//
// Position is across the whole GRADE (e.g. every "Form 3" stream at the
// campus), because that is what the physical report form shows ("Position 3
// out of 210"); stream position is computed alongside it.
export async function computeExamResults({ organizationId, examId, classId }) {
  const cls = (await query(
    `SELECT id, name, grade, section, grading_scheme, center_id FROM classes WHERE id = $1 AND organization_id = $2`,
    [classId, organizationId])).rows[0];
  if (!cls) return null;
  const formLevel = formLevelOf(cls.grade);
  const scheme = cls.grading_scheme;

  const peers = (await query(
    `SELECT id, name FROM classes WHERE organization_id = $1 AND center_id = $2 AND grade = $3`,
    [organizationId, cls.center_id, cls.grade])).rows;
  const peerIds = peers.map((p) => p.id);
  const classNameById = Object.fromEntries(peers.map((p) => [p.id, p.name]));

  const [students, subjects, marks, remarks] = await Promise.all([
    query(`SELECT id, full_name, school_id_number, class_id, kcpe_marks FROM students
           WHERE class_id = ANY($1::uuid[]) AND status = 'active' ORDER BY full_name`, [peerIds]),
    query(`SELECT id, name, code, is_science FROM subjects
           WHERE organization_id = $1 AND center_id = $2 AND (section IS NULL OR section = $3) ORDER BY code NULLS LAST, name`,
      [organizationId, cls.center_id, cls.section]),
    query(`SELECT m.student_id, m.subject_id, m.grade, m.points, m.percent FROM marks m
           JOIN students s ON s.id = m.student_id
           WHERE m.exam_id = $1 AND s.class_id = ANY($2::uuid[])`, [examId, peerIds]),
    query(`SELECT r.student_id, r.text FROM remarks r JOIN students s ON s.id = r.student_id
           WHERE r.exam_id = $1 AND s.class_id = ANY($2::uuid[])`, [examId, peerIds]),
  ]);
  const subjById = Object.fromEntries(subjects.rows.map((s) => [s.id, s]));
  const marksByStudent = {};
  for (const m of marks.rows) (marksByStudent[m.student_id] ??= []).push(m);
  const remarkByStudent = Object.fromEntries(remarks.rows.map((r) => [r.student_id, r.text]));

  const rows = students.rows.map((st) => {
    const input = (marksByStudent[st.id] || [])
      .filter((m) => subjById[m.subject_id])
      .map((m) => ({
        subjectId: m.subject_id, name: subjById[m.subject_id].name, code: subjById[m.subject_id].code,
        isScience: subjById[m.subject_id].is_science,
        percent: m.percent == null ? null : Number(m.percent), grade: m.grade, points: m.points,
      }));
    const r = computeStudentResult({ scheme, marks: input, formLevel });
    return { student: st, className: classNameById[st.class_id], classId: st.class_id,
             remarkText: remarkByStudent[st.id] || null, subjectsDone: input.length, ...r };
  });

  // Ranking key: mean %, or mean points scaled to 0-100 if every mark was a direct level.
  const topPts = scheme === 'cbc' ? 8 : 12;
  const key = (r) => (r.mean != null ? r.mean : (r.meanPoints / topPts) * 100);
  const eligible = rows.filter((r) => r.eligible && r.meanPoints != null);
  const overall = rank(eligible, key);
  eligible.forEach((r) => { r.position = overall.get(r); r.outOf = eligible.length; });
  for (const p of peers) {
    const inClass = eligible.filter((r) => r.classId === p.id);
    const cr = rank(inClass, key);
    inClass.forEach((r) => { r.classPosition = cr.get(r); r.classOutOf = inClass.length; });
  }
  rows.filter((r) => !r.eligible || r.meanPoints == null).forEach((r) => { r.position = null; r.outOf = eligible.length; r.classPosition = null; });

  // Per-subject position across the grade (the "Position per Subject" column).
  const subjectPosition = {};
  for (const sub of subjects.rows) {
    const withMark = rows.map((r) => ({ r, m: r.marks.find((x) => x.subjectId === sub.id) })).filter((x) => x.m);
    const sk = (x) => (x.m.percent != null ? Number(x.m.percent) : (x.m.points / topPts) * 100);
    const rk = rank(withMark, sk);
    withMark.forEach((x) => { (subjectPosition[x.r.student.id] ??= {})[sub.id] = rk.get(x); });
  }
  rows.forEach((r) => {
    r.marks = r.marks.map((m) => ({ ...m, position: subjectPosition[r.student.id]?.[m.subjectId] ?? null,
      remark: remarkFor(scheme, (m.points || 1) - 1) }));
  });

  // Mean and total are shown for each student even when ineligible? No:
  // ineligible students get "W" (no results) and no position, per the rules.
  return { class: cls, scheme, subjects: subjects.rows, rows, peers, rankedCount: eligible.length };
}

export async function computeStudentCard({ organizationId, studentId, examId }) {
  const st = (await query(`SELECT class_id FROM students WHERE id = $1 AND organization_id = $2`, [studentId, organizationId])).rows[0];
  if (!st?.class_id) return null;
  const data = await computeExamResults({ organizationId, examId, classId: st.class_id });
  if (!data) return null;
  const row = data.rows.find((r) => r.student.id === studentId);
  return row ? { ...data, row } : null;
}
