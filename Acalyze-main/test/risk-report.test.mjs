import test from 'node:test';
import assert from 'node:assert/strict';

const SUBJ = [['MAT', '121', 'Mathematics', true], ['ENG', '101', 'English'], ['KIS', '102', 'Kiswahili'], ['BIO', '231', 'Biology', true], ['PHY', '232', 'Physics', true], ['CHE', '233', 'Chemistry', true], ['GEO', '312', 'Geography']];
const seven = (sid, p) => SUBJ.map(([id], i) => ({ student_id: sid, subject_id: id, grade: 'X', points: 1, percent: Array.isArray(p) ? p[i] : p }));
const stu = (id, name, kcpe = 330) => ({ id, full_name: name, school_id_number: id, class_id: 'c1', kcpe_marks: kcpe });
globalThis.__DB = {
  classes: [{ id: 'c1', name: 'Form 3 West', grade: 'Form 3', section: 'SENIOR', grading_scheme: '844', center_id: 'ce', class_teacher_id: null }],
  subjects: SUBJ.map(([id, code, name, is_science = false]) => ({ id, code, name, is_science })),
  students: [stu('F', 'Falling'), stu('S', 'Stable'), stu('M', 'Missed'), stu('W', 'Weak'), stu('K', 'Target', 450)],
  recentExams: [{ id: 'e2', name: 'Term 3' }, { id: 'e1', name: 'Term 2' }, { id: 'e0', name: 'Term 1' }],
  marks: {
    e0: [...seven('F', 80), ...seven('S', 60), ...seven('M', 60), ...seven('W', 60), ...seven('K', 60)],
    e1: [...seven('F', 70), ...seven('S', 61), ...seven('M', 60), ...seven('W', 60), ...seven('K', 60)],
    e2: [...seven('F', 55), ...seven('S', 60), ...seven('W', [20, 25, 28, 70, 70, 70, 70]), ...seven('K', 60)],
  },
};
const { riskReport } = await import('../src/lib/risk.js');
const rep = await riskReport({ organizationId: 'o', examId: 'e2' });
const by = Object.fromEntries(rep.items.map((i) => [i.name, i]));

test('report is built from the latest exam and names the previous one', () => {
  assert.equal(rep.exam.name, 'Term 3'); assert.equal(rep.previous.name, 'Term 2');
});
test('a steadily falling student is high risk, with both reasons spelled out', () => {
  assert.equal(by.Falling.level, 'high');
  assert.ok(by.Falling.flags.some((f) => /Dropped 15 points since Term 2/.test(f.text)) && by.Falling.flags.some((f) => /three exams in a row/.test(f.text)));
});
test('a steady student is not listed at all', () => assert.equal(by.Stable, undefined));
test('a student who missed the exam is flagged as missed', () => assert.ok(by.Missed.flags.some((f) => f.kind === 'missed')));
test('weak subjects and a sharp subject fall are caught together', () => {
  assert.ok(by.Weak.flags.some((f) => f.kind === 'weak') && by.Weak.flags.some((f) => /Mathematics fell 40 points/.test(f.text)));
});
test('KCPE-based target flag appears for a high KCPE student scoring 60%', () => assert.ok(by.Target.flags.some((f) => f.kind === 'target')));
test('worst cases come first, and the counts add up', () => {
  assert.equal(rep.items[0].name, 'Falling');
  assert.equal(rep.counts.high + rep.counts.medium + rep.counts.watch, rep.items.length);
});
