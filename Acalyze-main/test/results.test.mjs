import test from 'node:test';
import assert from 'node:assert/strict';

const C = (id, name) => ({ id, name, grade: 'Form 3', section: 'SENIOR', grading_scheme: '844', center_id: 'c1', class_teacher_id: null });
const sub = (id, code, name, sci = false) => ({ id, code, name, is_science: sci });
const S = (id, name, cls) => ({ id, full_name: name, school_id_number: id, class_id: cls, kcpe_marks: 400 });
const mk = (sid, o) => Object.entries(o).map(([subject_id, percent]) => ({ student_id: sid, subject_id, grade: 'X', points: 1, percent }));
const full = { MAT: 80, ENG: 70, KIS: 70, BIO: 70, PHY: 70, CHE: 70, GEO: 70 };
globalThis.__DB = {
  classes: [C('cW', 'Form 3 West'), C('cE', 'Form 3 East')], prevExam: null,
  subjects: [sub('MAT', '121', 'Mathematics', true), sub('ENG', '101', 'English'), sub('KIS', '102', 'Kiswahili'), sub('BIO', '231', 'Biology', true), sub('PHY', '232', 'Physics', true), sub('CHE', '233', 'Chemistry', true), sub('GEO', '312', 'Geography'), sub('CRE', '313', 'CRE'), sub('AGR', '443', 'Agriculture')],
  students: [S('A', 'Amina', 'cW'), S('B', 'Brian', 'cW'), S('E', 'Esther', 'cW'), S('C', 'Carol', 'cE'), S('D', 'Daniel', 'cE'), S('F', 'Faith', 'cE')],
  marks: {
    ex1: [...mk('A', full), ...mk('B', full), ...mk('C', { ...full, CRE: 95, AGR: 20 }), ...mk('D', { MAT: 90, ENG: 90, KIS: 90, BIO: 90, PHY: 90 }), ...mk('F', { ENG: 90, KIS: 90, BIO: 90, PHY: 90, CHE: 90, GEO: 90, CRE: 90 })],
    ex0: [...mk('A', { ...full, MAT: 60, ENG: 50 }), ...mk('B', { MAT: 95, ENG: 95, KIS: 95, BIO: 95, PHY: 95, CHE: 95, GEO: 95 })],
  },
};
const { computeExamResults } = await import('../src/lib/results.js');
const { examAnalytics } = await import('../src/lib/analytics.js');
const rows = async () => Object.fromEntries((await computeExamResults({ organizationId: 'o', examId: 'ex1', classId: 'cW' })).rows.map((r) => [r.student.id, r]));

test('positions are across the whole grade, with ties sharing a place', async () => {
  const by = await rows();
  assert.equal(by.C.position, 1); assert.equal(by.A.position, 2); assert.equal(by.B.position, 2);
  assert.equal(by.A.outOf, 3, 'out-of counts only ranked students');
});
test('stream position is computed inside each class', async () => {
  const by = await rows();
  assert.deepEqual([by.A.classPosition, by.A.classOutOf, by.C.classPosition, by.C.classOutOf], [1, 2, 1, 1]);
});
test('ineligible students get no position and a clear reason', async () => {
  const by = await rows();
  assert.equal(by.D.eligible, false); assert.match(by.D.reason, /5 subjects/); assert.equal(by.D.position, null);
  assert.equal(by.F.eligible, false); assert.match(by.F.reason, /Mathematics/);
  assert.equal(by.E.subjectsDone, 0);
});
test('the best-six rule excludes the weakest subject from the mean', async () => {
  const c = (await rows()).C;
  assert.equal(c.marks.find((m) => m.subjectId === 'AGR').isCounted, false);
  assert.ok(Math.abs(c.mean - 75) < 1e-9);
});
test('every mark carries a subject position and a teacher remark', async () => {
  const a = (await rows()).A;
  assert.ok(a.marks.every((m) => m.position >= 1 && typeof m.remark === 'string'));
});
test('analytics: podium, class comparison, champions, attention lists', async () => {
  const a = await examAnalytics({ organizationId: 'o', examId: 'ex1' });
  assert.equal(a.grades.length, 1);
  const g = a.grades[0];
  assert.equal(g.top3[0].name, 'Carol'); assert.equal(g.classes.length, 2);
  assert.equal(g.missedCount, 1); assert.equal(g.ineligible.length, 2);
  assert.equal(Object.values(g.gradeDistribution).reduce((x, y) => x + y, 0), 3);
  assert.equal(a.hasPrevious, false); assert.deepEqual(g.improved, []);
});
test('analytics: most improved and biggest drops against the previous exam', async () => {
  globalThis.__DB.prevExam = 'ex0';
  const g = (await examAnalytics({ organizationId: 'o', examId: 'ex1' })).grades[0];
  assert.ok(g.improved.some((m) => m.name === 'Amina' && m.change > 0));
  assert.ok(g.dropped.some((m) => m.name === 'Brian' && m.change < 0));
  globalThis.__DB.prevExam = null;
});
