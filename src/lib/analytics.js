import { query } from './db.js';
import { computeExamResults } from './results.js';
import { pointsToPercent } from './grading.js';

const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

// Ranking score that works for both full-percentage and direct-level marks.
const scoreOf = (r, gScheme) => (r.mean != null ? r.mean : r.meanPoints != null ? pointsToPercent(gScheme, r.meanPoints) : null);

// Everything the school-admin dashboard shows for one exam, grouped by grade
// (Form 3 vs Grade 8 etc. are never mixed: different schemes aren't comparable).
export async function examAnalytics({ organizationId, examId }) {
  const classes = (await query(
    `SELECT id, name, grade, center_id, grading_scheme FROM classes WHERE organization_id = $1 ORDER BY grade, name`,
    [organizationId])).rows;

  const groups = new Map(); // "centerId|grade" -> classes
  classes.forEach((c) => { const k = `${c.center_id}|${c.grade}`; (groups.get(k) || groups.set(k, []).get(k)).push(c); });

  // Previous exam (for "most improved / most dropped")
  const prevExam = (await query(
    `SELECT id FROM exams WHERE organization_id = $1 AND created_at < (SELECT created_at FROM exams WHERE id = $2)
     ORDER BY created_at DESC LIMIT 1`, [organizationId, examId])).rows[0];

  const out = [];
  for (const [, cls] of groups) {
    const data = await computeExamResults({ organizationId, examId, classId: cls[0].id });
    if (!data || !data.rows.length) continue;
    const gScheme = data.scheme;
    const eligible = data.rows.filter((r) => r.eligible && r.meanPoints != null);

    const top3 = [...eligible].sort((a, b) => a.position - b.position).slice(0, 3)
      .map((r) => ({ name: r.student.full_name, className: r.className, mean: round1(scoreOf(r, gScheme)), grade: r.grade, position: r.position }));

    // Class comparison + best class per subject
    const classRows = cls.map((c) => {
      const mine = eligible.filter((r) => r.classId === c.id);
      const perSubject = {};
      for (const sub of data.subjects) {
        const vals = data.rows.filter((r) => r.classId === c.id)
          .map((r) => r.marks.find((m) => m.subjectId === sub.id)).filter(Boolean)
          .map((m) => (m.percent != null ? Number(m.percent) : pointsToPercent(gScheme, m.points)));
        perSubject[sub.id] = round1(avg(vals));
      }
      return { classId: c.id, name: c.name, students: data.rows.filter((r) => r.classId === c.id).length,
               ranked: mine.length, mean: round1(avg(mine.map((r) => scoreOf(r, gScheme)))),
               meanPoints: round1(avg(mine.map((r) => r.meanPoints))), perSubject };
    });
    const bestBySubject = {};
    for (const sub of data.subjects) {
      const best = classRows.filter((c) => c.perSubject[sub.id] != null).sort((a, b) => b.perSubject[sub.id] - a.perSubject[sub.id])[0];
      if (best) bestBySubject[sub.id] = best.classId;
    }

    // Subject champions + subject means
    const subjects = data.subjects.map((sub) => {
      const entries = data.rows.map((r) => ({ r, m: r.marks.find((m) => m.subjectId === sub.id) })).filter((x) => x.m)
        .map((x) => ({ ...x, s: x.m.percent != null ? Number(x.m.percent) : pointsToPercent(gScheme, x.m.points) }));
      const top = [...entries].sort((a, b) => b.s - a.s)[0];
      return { id: sub.id, name: sub.name, code: sub.code, entries: entries.length, mean: round1(avg(entries.map((e) => e.s))),
               champion: top ? { name: top.r.student.full_name, className: top.r.className, score: round1(top.s), grade: top.m.grade } : null };
    });

    // Grade distribution of overall grades
    const dist = {};
    eligible.forEach((r) => { dist[r.grade] = (dist[r.grade] || 0) + 1; });

    // Attention list: no marks at all, and ineligible (W) with reasons
    const missed = data.rows.filter((r) => r.subjectsDone === 0).map((r) => ({ name: r.student.full_name, className: r.className }));
    const ineligible = data.rows.filter((r) => r.subjectsDone > 0 && !r.eligible)
      .map((r) => ({ name: r.student.full_name, className: r.className, reason: r.reason }));

    // Movers vs the previous exam
    let improved = [], dropped = [];
    if (prevExam) {
      const prev = await computeExamResults({ organizationId, examId: prevExam.id, classId: cls[0].id });
      if (prev) {
        const prevScore = new Map(prev.rows.filter((r) => r.eligible && r.meanPoints != null).map((r) => [r.student.id, scoreOf(r, gScheme)]));
        const deltas = eligible.filter((r) => prevScore.has(r.student.id))
          .map((r) => ({ name: r.student.full_name, className: r.className, change: round1(scoreOf(r, gScheme) - prevScore.get(r.student.id)) }));
        improved = [...deltas].sort((a, b) => b.change - a.change).filter((d) => d.change > 0).slice(0, 5);
        dropped = [...deltas].sort((a, b) => a.change - b.change).filter((d) => d.change < 0).slice(0, 5);
      }
    }

    out.push({
      grade: cls[0].grade, scheme: data.scheme,
      students: data.rows.length, ranked: eligible.length, missedCount: missed.length,
      mean: round1(avg(eligible.map((r) => scoreOf(r, gScheme)))),
      top3, classes: classRows, bestBySubject, subjects,
      gradeDistribution: dist, missed, ineligible: ineligible.slice(0, 15), improved, dropped,
    });
  }
  return { examId, hasPrevious: !!prevExam, grades: out };
}
