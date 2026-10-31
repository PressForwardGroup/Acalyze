import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarksWorkbook, classOfTitle, markOf } from '../public/js/marksExcel.js';

const primary = [
  ["MISSION OF HOPE BOYS' BOARDING AND DAY MIXED PRIMARY SCHOOL"], [], ['END TERM TWO EXAM 2026'], ['GRADE FOUR RED TR.KELVIN MACHARIA'],
  [null, 'NAME', 'MATHS', 'GRAMMAR', 'WRITING', 'ENGLISH', 'LUGHA', 'INSHA', 'KISWAHILI', 'SCIE&TECH', 'TOTAL', 'MEAN', 'GRADE'],
  [1, 'EMILY KANINI MULEI ', 87, 26, 17, '86', 27, 26, '106', 96, '402', 89.2, 'R'],
  [2, 'SASHA MWIKALI MUNYAO ', 93, 25, 17, '84', 25, 25, '100', 'ABS', '302', '87', 'R'],
  [null, 'MEAN', 90, null, null, 85, null, null, 103, 96, null, null, null],
];
const junior = [
  [], [null, 'END TERM TWO EXAM 2026'], [null, 'GRADE 7 LOVE  TR. FAITH'],
  [null, 'GRADE 7 LOVE', 'MATHS', 'ENG PP1', 'ENG PP2', 'TOTAL', 'KARATASI 1', 'KARATASI 2', 'JUMLA', 'INTER SCIENCE', 'TOTALS', 'MEAN', 'GRADE'],
  [1, 'BRIAN MUTUA MUMO ', 12, 27, 10, 37, 25, 21, '46', 32, '301', 33.4, 'L'],
];

test('class titles: grade in words or digits, the stream, and the teacher after "TR" dropped', () => {
  assert.deepEqual(classOfTitle('GRADE FOUR RED       TR .CINTHIA KIOKO'), { grade: 'Grade 4', stream: 'Red', className: 'Grade 4 Red' });
  assert.equal(classOfTitle('GRADE 9   LOVE   TR.CYNTHIA TANGUT').className, 'Grade 9 Love');
  assert.equal(classOfTitle('PP1  RED         TR .CAROLINE MUMO').className, 'PP1 Red');
  assert.equal(classOfTitle('GRADE 8  PATIENCE   TR.').className, 'Grade 8 Patience');
  assert.equal(classOfTitle('END TERM TWO EXAM 2026'), null);
});
test('a mark as typed; anything else is no mark', () => {
  assert.deepEqual([markOf(86), markOf('86'), markOf('106'), markOf('86.5'), markOf('ABS'), markOf(''), markOf(null)], [86, 86, 106, 86.5, null, null, null]);
});
test('a primary sheet: learners, subject columns only (not TOTAL/MEAN/GRADE), summary rows ignored', () => {
  const r = parseMarksWorkbook({ 'GRD 4 RED': primary });
  const s = r.sheets[0];
  assert.deepEqual([s.className, s.exam, s.students.length], ['Grade 4 Red', 'END TERM TWO EXAM 2026', 2]);
  assert.deepEqual(s.columns.map((c) => c.header), ['MATHS', 'GRAMMAR', 'WRITING', 'ENGLISH', 'LUGHA', 'INSHA', 'KISWAHILI', 'SCIE&TECH']);
  assert.equal(s.students[0].name, 'EMILY KANINI MULEI');
  assert.equal(s.students[0].values[String(s.columns.findIndex((c) => c.header === 'KISWAHILI') + 2)], 106);
  assert.equal(s.absent, 1, '"ABS" is counted, not turned into a zero');
});
test('a junior sheet: the name column carries the class title, and the English total keeps its place before the overall TOTALS', () => {
  const r = parseMarksWorkbook({ 'GRD 7 LOVE': junior });
  assert.deepEqual(r.sheets[0].columns.map((c) => c.header), ['MATHS', 'ENG PP1', 'ENG PP2', 'TOTAL', 'KARATASI 1', 'KARATASI 2', 'JUMLA', 'INTER SCIENCE']);
  assert.equal(r.sheets[0].className, 'Grade 7 Love');
});
test('the class title may come before the exam line, and the class can come from the sheet name if the title is missing', () => {
  const swapped = [[], [null, 'GRADE 7 PEACE   TR.ELIZABETH'], [null, 'END TERM TWO EXAM 2026'], junior[3], junior[4]];
  assert.equal(parseMarksWorkbook({ x: swapped }).sheets[0].className, 'Grade 7 Peace');
  const noTitle = [[null, 'END TERM TWO EXAM 2026'], junior[3], junior[4]];
  assert.equal(parseMarksWorkbook({ 'GRD 8 JOY': noTitle }).sheets[0].className, 'Grade 8 Joy');
});
test('combined copies, sheets with admission numbers and unreadable sheets are left out with a reason', () => {
  const adm = [[], [], [], ['ADM NO', 'NAME', 'MATHS', 'ENG', 'KIS', 'TOTAL', 'MEAN'], [1, 'A B', 1, 2, 3, 6, 2]];
  const r = parseMarksWorkbook({ 'GRD 4 RED': primary, 'G4 COMBINED ': primary, 'FORM 3': adm, Notes: [['hello']] });
  assert.equal(r.sheets.length, 1);
  assert.ok(r.notes.some((n) => /COMBINED/.test(n)) && r.notes.some((n) => /admission numbers/.test(n)) && r.notes.some((n) => /Notes/.test(n)));
});
test('different spellings of the same exam are not flagged; a different exam is', () => {
  const dash = JSON.parse(JSON.stringify(primary)); dash[2] = ['END-TERM TWO EXAM 2026'];
  const mid = JSON.parse(JSON.stringify(primary)); mid[2] = ['MID TERM TWO EXAM 2026']; mid[3] = ['GRADE FOUR BLUE TR.X'];
  const a = parseMarksWorkbook({ a: primary, b: dash, c: primary.map((r) => r), d: JSON.parse(JSON.stringify(primary)).map((r, i) => (i === 3 ? ['GRADE FOUR GREEN TR.X'] : r)) });
  assert.ok(!a.notes.some((n) => /Check it is the same exam/.test(n)));
  const b = parseMarksWorkbook({ a: primary, b: JSON.parse(JSON.stringify(primary)).map((r, i) => (i === 3 ? ['GRADE FOUR BLUE TR.X'] : r)), m: mid });
  assert.ok(b.notes.some((n) => /MID TERM TWO EXAM 2026/.test(n) && /Check it is the same exam/.test(n)));
});
