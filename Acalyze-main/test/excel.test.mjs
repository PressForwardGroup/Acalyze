import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSheet, parseWorkbook, levelOf, subjectName } from '../public/js/excel.js';

// Synthetic rows laid out exactly like the three real template layouts (no real student data).
const pad = (a, n = 20) => [...a, ...Array(Math.max(0, n - a.length)).fill(null)];
const form3 = (students) => [pad(['', 'MOHI']), pad(['', 'FORM 3']), pad(['', 'END TERM II- 2026', 'KCPE', null, null, null, null, null, null, null, null, null, null, null, null, 'SUBJ', 'KCPE']),
  pad(['', 'STUDENT NAME', 'ADM NO', 'ENG', 'KIS', 'MAT', 'BIO', 'PHY', 'CHEM', 'HAG', 'GEO', 'CRE', 'AGR', 'COMP', 'BUS', 'ENTRY', 'MARKS', 'STRMS']), ...students];
const form4 = (students) => [pad(['', 'MOHI']), pad(['', 'FORM 4', 'I', 'II']), pad(['', '', '', 'ENG', 'KIS', 'MAT', 'BIO']), pad(['', 'STUDENT NAME', 'CODE', 101, 102, 121, 231, null, null, null, null, null, null, null, null, 'SUBJ', 'KCPE', 'STRMS']), ...students];
const g10 = (students) => [pad(['', 'GRADE 10-2026']), pad(['', 'END TERM II- 2026']), pad([]), pad(['', '', 'CODE', 'ASS NO', 'PATHWAY', 'ENG', 'KIS', 'CORE MAT', 'EST MATHS', 'P/MECS', 'ENTRY', 'KJSEA', 'STRMS']), ...students];
const g10fixed = (students) => [pad(['', 'GRADE 10-2026']), pad([]), pad([]), pad([]), pad(['', '', '', 'ASS NO', 'PATHWAY', 'ENG', 'KIS', 'CORE MAT', 'EST MATHS', 'P/MECS', 'ENTRY', 'KJSEA', 'STRMS']), ...students];

const f3row = (n, adm, marks, stream = '3 WEST', kcpe = 400) => pad(['', n, adm, ...marks, ...Array(Math.max(0, 12 - marks.length)).fill(null), 7, kcpe, stream]);   // always 12 subject columns, like the template

test('level is read from the sheet name', () => {
  assert.deepEqual(levelOf('FORM 3'), { kind: 'form', number: 3, grade: 'Form 3', scheme: '844', section: 'SENIOR' });
  assert.equal(levelOf('GRADE 10').scheme, 'cbc'); assert.equal(levelOf('grade 8').section, 'JUNIOR'); assert.equal(levelOf('Sheet29'), null);
});
test('Form 3 layout: subjects, codes, students, KCPE and stream', () => {
  const s = parseSheet(form3([f3row('Amina Otieno', 1001, [80, 70, 60, 50, 40, 30, 20, 10, 55, 65, 75, 85]), f3row('Brian Kiprop', 1002, [55, 66, null, 'x', 1, 2, 3, 4, 5, 6, 7, 8], '3 EAST', 350)]), 'FORM 3');
  assert.ok(!s.skipped); assert.equal(s.students.length, 2);
  assert.deepEqual(s.subjects.slice(0, 3).map((x) => x.key), ['ENG', 'KIS', 'MAT']);
  assert.equal(s.students[0].adm, '1001'); assert.equal(s.students[0].kcpe, 400); assert.equal(s.students[0].stream, 'West');
  assert.equal(s.students[1].marks.MAT, undefined, 'blank is not a mark'); assert.equal(s.students[1].marks.BIO, undefined, '"x" is not a mark');
  assert.ok(s.issues.some((i) => /"x"/.test(i)));
});
test('Form 4 layout: subject names one row above STUDENT NAME, codes below', () => {
  const s = parseSheet(form4([pad(['', 'Carol Wanjiru', 1485, 56, 40, 70, 28, null, null, null, null, null, null, null, null, 4, 326, '4 WEST'])]), 'FORM 4');
  assert.deepEqual(s.subjects.map((x) => [x.key, x.code]), [['ENG', '101'], ['KIS', '102'], ['MAT', '121'], ['BIO', '231']]);
  assert.equal(s.students[0].marks.MAT, 70); assert.equal(s.students[0].kcpe, 326);
});
test('Grade 10 layout: no STUDENT NAME header, metadata columns skipped, KJSEA ignored', () => {
  const s = parseSheet(g10fixed([pad(['', 'Esther Achieng', 153, null, null, 60, 70, 80, null, null, 0, 0, 'CENTRAL'])]), 'GRADE 10');
  assert.deepEqual(s.subjects.map((x) => x.key), ['ENG', 'KIS', 'CORE MAT', 'EST MATHS']);
  assert.equal(s.students.length, 1); assert.equal(s.students[0].name, 'Esther Achieng'); assert.equal(s.students[0].kcpe, null);
  assert.equal(s.students[0].stream, 'Central'); assert.equal(s.level.scheme, 'cbc');
});
test('messy values: "63-" is read as 63 and noted; text is dropped', () => {
  const s = parseSheet(form3([f3row('A', 1, ['63-', '-', 50, 50, 50, 50, 50, 50, 50, 50, 50, 50])]), 'FORM 3');
  assert.equal(s.students[0].marks.ENG, 63); assert.equal(s.students[0].marks.KIS, undefined);
  assert.ok(s.issues.some((i) => /"63-" was read as 63/.test(i)) && s.issues.some((i) => /"-" is not a number/.test(i)));
});
test('stream spelling variants merge, and a wrong-form stream is flagged', () => {
  const s = parseSheet(form3([f3row('A', 1, [50], '3 NORTH WEST'), f3row('B', 2, [50], '3 NORTHWEST'), f3row('C', 3, [50], '4 SOUTH WEST'), f3row('D', 4, [50], '3 SOUTH WEST')]), 'FORM 3');
  assert.deepEqual([...new Set(s.students.map((x) => x.stream))].sort(), ['North West', 'South West']);
  assert.ok(s.issues.some((i) => /another form's stream/.test(i)));
});
test('duplicate and missing admission numbers are reported', () => {
  const s = parseSheet(form3([f3row('A', 7, [50]), f3row('B', 7, [60]), f3row('C', '', [70])]), 'FORM 3');
  assert.ok(s.issues.some((i) => /shared by A and B/.test(i)) && s.issues.some((i) => /no admission number/.test(i)));
});
test('a paper marked out of 50 is flagged and a sensible out-of is suggested', () => {
  const rows = Array.from({ length: 8 }, (_, i) => f3row('S' + i, 100 + i, [60, 60, [2, 3, 2, 47, 3, 2, 3, 2][i], 50, 50, 50, 50, 50, 50, 50, 50, 50]));
  const maths = parseSheet(form3(rows), 'FORM 3').subjects.find((x) => x.key === 'MAT');
  assert.equal(maths.suspicious, true); assert.equal(maths.suggestedOutOf, 50); assert.ok(maths.reasons.length);
});
test('sheets that are not marks sheets are ignored, unknown level names are explained', () => {
  const out = parseWorkbook({ Sheet29: [['x']], 'FORM 3': form3([f3row('A', 1, [50])]), 'My Class': form3([f3row('B', 2, [50])]) });
  assert.deepEqual(out.map((s) => s.name), ['FORM 3', 'My Class']); assert.match(out[1].skipped, /class level/);
});
test('subject names are filled in from the short codes', () => {
  assert.equal(subjectName('HAG'), 'History & Government'); assert.equal(subjectName('CORE MAT'), 'Core Mathematics'); assert.equal(subjectName('XYZ'), 'Xyz');
});
