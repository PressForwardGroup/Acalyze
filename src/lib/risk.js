import { query } from './db.js';
import { computeExamResults } from './results.js';
import { pointsToPercent } from './grading.js';

// "Students to watch": early-warning flags from each student's last few exams.
// This is NOT a prediction model. It applies plain, explainable rules, and every
// flag carries the reason in words, so a teacher can see exactly why a student
// is listed and decide what to do.
//
// Severity weights: high = 3, medium = 2, low = 1. Level from the total:
//   5+ -> "high", 3-4 -> "medium", 1-2 -> "watch".
const W = { high: 3, medium: 2, low: 1 };
const r1 = (n) => Math.round(n * 10) / 10;

export const RULES = {
  bigDrop: 10, hugeDrop: 15,            // points of mean % lost since the previous exam
  streak: 2,                            // each of the last 3 exams lower than the one before by at least this
  belowTarget: 10,                      // points below the KCPE-based target (8-4-4)
  weakSubject: 30, weakSubjectCount: 3, // subjects under this % ...
  subjectDrop: 20, subjectDropBelow: 50,
  bottomShare: 0.1, bottomMinRanked: 10,
};

export function levelFor(score) { return score >= 5 ? 'high' : score >= 3 ? 'medium' : score >= 1 ? 'watch' : 'ok'; }

// Pure: given one student's history, return their flags. history = [{examName, score, subjects:{id:{name,percent}}, eligible, subjectsDone}] newest first.
export function flagsFor({ history, kcpe = null, position = null, rankedCount = 0, scheme = '844' }) {
  const flags = [], add = (kind, severity, text) => flags.push({ kind, severity, text });
  const [cur, prev, prev2] = history;
  if (!cur) return flags;

  if (cur.subjectsDone === 0) { add('missed', 'high', 'Has no marks for this exam'); return flags; }
  if (!cur.eligible) add('incomplete', 'low', 'Not enough subjects for an overall result');

  if (cur.score != null && prev?.score != null) {
    const d = cur.score - prev.score;
    if (d <= -RULES.hugeDrop) add('drop', 'high', `Dropped ${r1(-d)} points since ${prev.examName}`);
    else if (d <= -RULES.bigDrop) add('drop', 'medium', `Dropped ${r1(-d)} points since ${prev.examName}`);
  }
  if (cur.score != null && prev?.score != null && prev2?.score != null
      && prev.score - cur.score >= RULES.streak && prev2.score - prev.score >= RULES.streak) {
    add('streak', 'high', `Falling for three exams in a row (${r1(prev2.score)}% to ${r1(prev.score)}% to ${r1(cur.score)}%)`);
  }
  if (scheme === '844' && kcpe && cur.score != null) {
    const target = kcpe / 5;
    if (target - cur.score >= RULES.belowTarget) add('target', 'medium', `Well below the KCPE-based target (${r1(cur.score)}% against ${r1(target)}%)`);
  }
  const weak = Object.values(cur.subjects).filter((s) => s.percent != null && s.percent < RULES.weakSubject);
  if (weak.length >= RULES.weakSubjectCount) add('weak', 'medium', `${weak.length} subjects under ${RULES.weakSubject}%: ${weak.slice(0, 4).map((s) => s.name).join(', ')}`);
  if (prev) {
    for (const [id, s] of Object.entries(cur.subjects)) {
      const was = prev.subjects[id];
      if (was?.percent != null && s.percent != null && was.percent - s.percent >= RULES.subjectDrop && s.percent < RULES.subjectDropBelow) {
        add('subject', 'medium', `${s.name} fell ${r1(was.percent - s.percent)} points to ${r1(s.percent)}%`); break;
      }
    }
  }
  if (position && rankedCount >= RULES.bottomMinRanked && position > rankedCount * (1 - RULES.bottomShare)) {
    add('bottom', 'low', `In the bottom 10% of the grade (position ${position} of ${rankedCount})`);
  }
  return flags;
}

export async function riskReport({ organizationId, examId, limit = 150 }) {
  const exams = (await query(
    `SELECT id, name FROM exams WHERE organization_id = $1 AND created_at <= (SELECT created_at FROM exams WHERE id = $2) ORDER BY created_at DESC LIMIT 3`,
    [organizationId, examId])).rows;
  if (!exams.length) return { exam: null, previous: null, items: [], counts: { high: 0, medium: 0, watch: 0 } };

  const classes = (await query(`SELECT id, grade, center_id, grading_scheme FROM classes WHERE organization_id = $1 ORDER BY grade, name`, [organizationId])).rows;
  const groups = new Map();
  for (const c of classes) { const k = `${c.center_id}|${c.grade}`; if (!groups.has(k)) groups.set(k, c); }

  const items = [];
  for (const [, c] of groups) {
    const perExam = [];
    for (const e of exams) perExam.push({ exam: e, data: await computeExamResults({ organizationId, examId: e.id, classId: c.id }) });
    if (!perExam[0].data) continue;
    const gScheme = c.grading_scheme;
    const scoreOf = (r) => (!r || !r.eligible || r.meanPoints == null ? null : r.mean != null ? r.mean : pointsToPercent(gScheme, r.meanPoints));
    const byExam = perExam.map(({ exam, data }) => ({ exam, rows: new Map((data?.rows || []).map((r) => [r.student.id, r])) }));

    for (const row of perExam[0].data.rows) {
      const history = byExam.map(({ exam, rows }) => {
        const r = rows.get(row.student.id);
        return { examName: exam.name, score: scoreOf(r), eligible: !!r?.eligible, subjectsDone: r?.subjectsDone || 0,
          subjects: Object.fromEntries((r?.marks || []).map((m) => [m.subjectId, { name: m.name, percent: m.percent == null ? null : Number(m.percent) }])) };
      });
      const flags = flagsFor({ history, kcpe: row.student.kcpe_marks, position: row.position, rankedCount: row.outOf || 0, scheme: perExam[0].data.scheme });
      const score = flags.reduce((n, f) => n + W[f.severity], 0);
      if (!score) continue;
      items.push({ studentId: row.student.id, name: row.student.full_name, admissionNo: row.student.school_id_number, className: row.className, grade: c.grade,
        level: levelFor(score), score, mean: history[0].score == null ? null : r1(history[0].score),
        change: history[0].score != null && history[1]?.score != null ? r1(history[0].score - history[1].score) : null, flags });
    }
  }
  items.sort((a, b) => b.score - a.score || (a.mean ?? 0) - (b.mean ?? 0));
  const counts = { high: 0, medium: 0, watch: 0 }; items.forEach((i) => counts[i.level]++);
  return { exam: exams[0], previous: exams[1] || null, items: items.slice(0, limit), total: items.length, counts };
}
