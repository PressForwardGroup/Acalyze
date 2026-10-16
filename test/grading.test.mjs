import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/lib/grading.js';

const mk = (rows) => rows.map(([name, code, percent], i) => ({ subjectId: 's' + i, name, code, percent, isScience: G.isScienceSubject({ name, code }) }));

test('8-4-4 boundaries: sciences are stricter than other subjects', () => {
  assert.equal(G.gradeFor('844', 79.5, { isScience: false, formLevel: 4 }).grade, 'A');
  assert.equal(G.gradeFor('844', 75, { isScience: false, formLevel: 4 }).grade, 'A-');
  assert.equal(G.gradeFor('844', 75, { isScience: true, formLevel: 4 }).grade, 'A');
  assert.equal(G.gradeFor('844', 0, {}).grade, 'E');
});
test('CBC levels and points', () => {
  assert.deepEqual([G.gradeFor('cbc', 95).grade, G.gradeFor('cbc', 95).points], ['EE1', 8]);
  assert.equal(G.gradeFor('cbc', 5).grade, 'BE2');
  assert.equal(G.gradeFor('cbc', 58).grade, 'ME1');
});
test('subjects are recognised by name OR report-form code', () => {
  assert.ok(G.isMathSubject({ name: 'Mathematics', code: '121' }));
  assert.ok(G.isMathSubject({ name: 'Core Mathematics', code: '201' }));
  assert.ok(G.isMathSubject({ name: 'x', code: 'MAT' }));
  assert.ok(!G.isMathSubject({ name: 'Geography', code: '312' }));
  assert.ok(G.isScienceSubject({ name: 'Physics', code: '232' }) && !G.isScienceSubject({ name: 'CRE', code: '313' }));
});
test('8-4-4: needs Mathematics and at least 7 subjects, else "W"', () => {
  const noMaths = G.computeStudentResult({ scheme: '844', marks: mk([['English', '101', 80], ['Kiswahili', '102', 80], ['Biology', '231', 80], ['Physics', '232', 80], ['Chemistry', '233', 80], ['Geography', '312', 80], ['CRE', '313', 80]]) });
  assert.equal(noMaths.eligible, false); assert.match(noMaths.reason, /Mathematics/);
  const few = G.computeStudentResult({ scheme: '844', marks: mk([['Mathematics', '121', 80], ['English', '101', 80], ['Kiswahili', '102', 80]]) });
  assert.equal(few.eligible, false); assert.match(few.reason, /3 subjects/); assert.equal(few.mean, null);
});
test('8-4-4: more than 7 subjects counts Mathematics plus the best six', () => {
  const r = G.computeStudentResult({ scheme: '844', marks: mk([['Mathematics', '121', 30], ['English', '101', 60], ['Kiswahili', '102', 55], ['Biology', '231', 70], ['Physics', '232', 20], ['Chemistry', '233', 65], ['Geography', '312', 80], ['CRE', '313', 90], ['Agriculture', '443', 50]]), formLevel: 4 });
  assert.equal(r.eligible, true);
  const counted = r.marks.filter((m) => m.isCounted).map((m) => m.name);
  assert.equal(counted.length, 7); assert.ok(counted.includes('Mathematics'));
  assert.ok(!counted.includes('Physics') && !counted.includes('Agriculture'), 'the two weakest are dropped');
});
test('CBC: exactly 7 subjects with Maths, Kiswahili, English and CSL', () => {
  const ok = mk([['Core Mathematics', '201', 70], ['Kiswahili', '102', 60], ['English', '101', 65], ['Community Service Learning', '199', 75], ['Biology', '231', 55], ['Geography', '312', 50], ['CRE', '313', 80]]);
  assert.equal(G.computeStudentResult({ scheme: 'cbc', marks: ok }).eligible, true);
  const noKis = G.computeStudentResult({ scheme: 'cbc', marks: ok.filter((m) => m.name !== 'Kiswahili').concat(mk([['Agriculture', '443', 50]])) });
  assert.match(noKis.reason, /Kiswahili/);
  assert.match(G.computeStudentResult({ scheme: 'cbc', marks: ok.concat(mk([['Agriculture', '443', 50]])) }).reason, /exactly 7/);
});
test('direct-level marks (no percentage) still produce a result', () => {
  const m = [['MAT', 'EE1', 8], ['KIS', 'ME1', 6], ['ENG', 'EE2', 7], ['CSL', 'ME2', 5], ['BIO', 'AE1', 4], ['GEO', 'ME1', 6], ['CRE', 'EE2', 7]].map(([code, grade, points], i) => ({ subjectId: 'x' + i, code, grade, points, percent: null }));
  const r = G.computeStudentResult({ scheme: 'cbc', marks: m });
  assert.equal(r.eligible, true); assert.equal(r.mean, null); assert.ok(Math.abs(r.meanPoints - 43 / 7) < 1e-9); assert.equal(r.grade, 'ME1');
});
test('scale check flags a paper marked out of 50 and read as 100', () => {
  const w = G.scaleCheck([2, 3, 2, 47, 3, 2, 3, 2, 30, 2]);
  assert.equal(w.suspicious, true); assert.equal(w.suggestedOutOf, 50);
  assert.equal(G.scaleCheck([55, 62, 71, 48, 90, 66, 58]).suspicious, false);
  assert.equal(G.suggestOutOf([28, 47, 12]), 50);
});
