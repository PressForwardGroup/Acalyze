import test from 'node:test';
import assert from 'node:assert/strict';
import { planImport, applyImport } from '../src/lib/importer.js';

const lvl3 = { kind: 'form', number: 3, grade: 'Form 3', scheme: '844', section: 'SENIOR' };
const lvl4 = { kind: 'form', number: 4, grade: 'Form 4', scheme: '844', section: 'SENIOR' };
const subjects = [{ key: 'ENG', code: '101', name: 'English' }, { key: 'MAT', code: '121', name: 'Mathematics' }];
const sheets = () => [
  { name: 'FORM 3', level: lvl3, subjects, outOf: { MAT: 50 }, students: [
    { name: 'Amina', adm: '1001', stream: 'West', kcpe: 400, marks: { ENG: 70, MAT: 47 } },
    { name: 'Brian', adm: '1002', stream: 'West', kcpe: null, marks: { ENG: 55 } },
    { name: 'Carol', adm: '1003', stream: null, kcpe: 999, marks: { ENG: 60, MAT: 80 } },        // MAT 80 is above out-of 50; KCPE 999 is impossible
    { name: 'No Adm', adm: '', stream: 'West', marks: { ENG: 50 } },
  ] },
  { name: 'FORM 4', level: lvl4, subjects, students: [{ name: 'Dup Person', adm: '1001', stream: 'East', marks: { ENG: 40 } }] },
  { name: 'Weird', level: null, subjects: [], students: [] },
];
const existing = () => ({
  classes: [{ id: 'cls-west', name: 'Form 3 West' }],
  subjects: [{ id: 'sub-eng', name: 'English', code: '101' }],
  students: [{ id: 'stu-brian', school_id_number: '1002', class_id: 'cls-other' }],
});

test('plan: reuses existing classes/subjects/students, creates the rest, and skips bad rows', () => {
  const p = planImport({ sheets: sheets(), existing: existing() });
  assert.deepEqual(p.summary.newClasses, ['Form 3 (no stream)']);
  assert.deepEqual(p.summary.newSubjects, ['Mathematics']);
  assert.equal(p.summary.studentsNew, 2); assert.equal(p.summary.studentsExisting, 1); assert.equal(p.summary.studentsMoved, 1);
  const msgs = p.skipped.join('\n');
  assert.match(msgs, /No Adm .*no admission number/); assert.match(msgs, /Dup Person.*already used by Amina/); assert.match(msgs, /Weird.*unknown class level/);
});
test('plan: marks use the per-subject out-of, the right grading scheme, and reject scores above out-of', () => {
  const p = planImport({ sheets: sheets(), existing: existing() });
  const amina = p.marks.filter((m) => m.adm === '1001');
  assert.equal(amina.find((m) => m.subjectRef === 's:mathematics').percent, 94);     // 47 / 50
  assert.equal(amina.find((m) => m.subjectRef === 's:mathematics').grade, 'A');      // Maths is a science: 94% -> A
  assert.equal(p.marks.filter((m) => m.adm === '1003').length, 1, 'Carol: ENG saved, MAT 80/50 rejected');
  assert.equal(p.summary.skippedMarks, 1); assert.match(p.skipped.join(), /score 80 is above "out of 50"/);
});
test('plan: impossible KCPE is dropped; roster-only mode saves no marks', () => {
  const p = planImport({ sheets: sheets(), existing: existing(), importMarks: false });
  assert.equal(p.students.find((s) => s.adm === '1003').kcpe, null); assert.equal(p.marks.length, 0);
});
test('plan: matching is case-insensitive and tolerant of padding', () => {
  const s = sheets(); s[0].students[1].adm = ' 1002 ';
  const p = planImport({ sheets: [s[0]], existing: { ...existing(), classes: [{ id: 'c', name: 'FORM 3 west' }] } });
  assert.equal(p.students.find((x) => x.name === 'Brian').existingId, 'stu-brian'); assert.deepEqual(p.summary.newClasses, ['Form 3 (no stream)']);
});

// A fake pg client that records every statement and hands back ids.
function fakeClient() {
  const calls = []; let n = 0;
  return { calls, query: async (sql, params = []) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    if (/INSERT INTO classes|INSERT INTO subjects/.test(sql)) return { rows: [{ id: 'new-' + ++n }] };
    if (/INSERT INTO students/.test(sql)) return { rows: params[2].map((a) => ({ id: 'stu-' + a, school_id_number: a })) };
    return { rows: [] };
  } };
}
test('apply: creates what is new, batches line up, and saves every planned mark', async () => {
  const p = planImport({ sheets: [sheets()[0]], existing: existing() });
  const c = fakeClient();
  const out = await applyImport(c, { organizationId: 'o', centerId: 'ce', examId: 'ex', plan: p });
  assert.equal(c.calls.filter((x) => /INSERT INTO classes/.test(x.sql)).length, 1);
  assert.equal(c.calls.filter((x) => /INSERT INTO subjects/.test(x.sql)).length, 1);
  const studentInsert = c.calls.find((x) => /INSERT INTO students/.test(x.sql));
  assert.ok([2, 3, 4, 5].map((i) => studentInsert.params[i].length).every((l) => l === studentInsert.params[2].length), 'student arrays are the same length');
  const mk = c.calls.find((x) => /INSERT INTO marks/.test(x.sql));
  assert.ok([1, 2, 3, 4, 5].map((i) => mk.params[i].length).every((l) => l === p.marks.length), 'mark arrays match the plan');
  assert.ok(mk.params[1].every(Boolean) && mk.params[2].every(Boolean), 'every mark resolved to a real student and subject id');
  assert.equal(out.marksSaved, p.marks.length);
  assert.ok(c.calls.some((x) => /UPDATE students/.test(x.sql)), 'existing student is updated');
});
test('apply: with no exam it writes the roster but no marks', async () => {
  const p = planImport({ sheets: [sheets()[0]], existing: existing() }); const c = fakeClient();
  const out = await applyImport(c, { organizationId: 'o', centerId: 'ce', examId: null, plan: p });
  assert.equal(out.marksSaved, 0); assert.ok(!c.calls.some((x) => /INSERT INTO marks/.test(x.sql)));
});
