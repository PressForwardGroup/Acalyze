import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarksWorkbook } from '../public/js/marksExcel.js';
import { planMarks, applyMarks, matchLearners } from '../src/lib/marksImport.js';

const ALL = ['PRIMARY', 'JUNIOR', 'SENIOR'];
const primary = [[], [], ['END TERM TWO EXAM 2026'], ['GRADE FOUR RED TR.K'],
  [null, 'NAME', 'MATHS', 'GRAMMAR', 'WRITING', 'ENGLISH', 'LUGHA', 'INSHA', 'KISWAHILI', 'SCIE&TECH', 'TOTAL', 'MEAN'],
  [1, 'EMILY KANINI MULEI', 87, 26, 17, '86', 27, 26, '106', 96, 0, 0], [2, 'SASHA MWIKALI MUNYAO', 93, 25, 17, '84', 25, 25, '100', 'ABS', 0, 0]];
const junior = [[], [null, 'END TERM TWO EXAM 2026'], [null, 'GRADE 7 LOVE TR.F'],
  [null, 'GRADE 7 LOVE', 'MATHS', 'ENG PP1', 'ENG PP2', 'TOTAL', 'KARATASI 1', 'KARATASI 2', 'JUMLA', 'INTER SCIENCE', 'TOTALS', 'MEAN'],
  [1, 'BRIAN MUTUA MUMO', 12, 27, 10, 37, 25, 21, '46', 32, 0, 0]];
const pp = [[], ['END TERM TWO EXAM 2026'], ['PP1 RED TR.C'], [null, 'NAME', 'MATHS', 'LANGUAGE', 'READING', 'TOTAL', 'MEAN'], [1, 'ABRAHAM MAINGI', 100, 90, 84, 0, 0]];

const world = () => ({
  classes: [{ id: 'g4', name: 'Grade 4 Red', grade: 'Grade 4', grading_scheme: 'cbc' }, { id: 'g7', name: 'Grade 7 Love', grade: 'Grade 7', grading_scheme: 'cbc' }, { id: 'p1', name: 'PP1 Red', grade: 'PP1', grading_scheme: 'cbc' }],
  students: [{ id: 's1', full_name: 'Emily Kanini Mulei', class_id: 'g4' }, { id: 's2', full_name: 'Mwikali Sasha Munyao', class_id: 'g4' },
    { id: 's3', full_name: 'Brian Mutua Mumo', class_id: 'g7' }, { id: 's4', full_name: 'Abraham Ndambuki Maingi', class_id: 'p1' }],
  subjects: [],
});
const plan = (wb, extra = {}) => planMarks({ sheets: parseMarksWorkbook(wb).sheets, existing: world(), sections: ALL, ...extra });
const pct = (p, studentId, subject) => p.marks.find((m) => m.studentId === studentId && m.subjectRef === `s:new:${subject.toLowerCase()}`)?.percent;

test('names match in any word order; a close name is accepted but listed; the rest are reported', () => {
  const rows = [{ name: 'EMILY KANINI MULEI' }, { name: 'SASHA MUNYAO' }, { name: 'NOBODY HERE' }, { name: 'JOHN KAMAU' }];
  const cls = [{ id: 'a', full_name: 'Mulei Emily Kanini' }, { id: 'b', full_name: 'Sasha Mwikali Munyao' }, { id: 'c', full_name: 'John Kamau' }, { id: 'd', full_name: 'John Kamau' }];
  const m = matchLearners(rows, cls);
  assert.equal(m.result.get(0).id, 'a'); assert.equal(m.result.get(1).id, 'b');
  assert.deepEqual(m.close, [{ sheetName: 'SASHA MUNYAO', systemName: 'Sasha Mwikali Munyao' }]);
  assert.deepEqual(m.unmatched, ['NOBODY HERE']); assert.deepEqual(m.ambiguous, ['JOHN KAMAU'], 'two learners with the same name: never guess');
});

test('primary: the sheet\'s own subject columns are used, not their parts; an impossible mark is left out and explained', () => {
  const p = plan({ 'GRD 4 RED': primary });
  assert.deepEqual(p.summary.newSubjects.sort(), ['English', 'Kiswahili', 'Mathematics', 'Science and Technology']);
  assert.equal(pct(p, 's1', 'English'), 86); assert.equal(pct(p, 's1', 'Mathematics'), 87); assert.equal(pct(p, 's2', 'Kiswahili'), 100);
  assert.equal(pct(p, 's1', 'Kiswahili'), undefined, '106 is above 100');
  assert.equal(pct(p, 's2', 'Science and Technology'), undefined, '"ABS" is no mark, not a zero');
  assert.equal(p.outOfHints.length, 1); assert.deepEqual([p.outOfHints[0].header, p.outOfHints[0].top], ['KISWAHILI', 106]);
  assert.equal(p.summary.matched, 2); assert.equal(p.summary.closeMatches, 0, 'same words in another order is an exact match');
});

test('"out of" turns 106 into a real percentage once the paper maximum is known', () => {
  const p = plan({ 'GRD 4 RED': primary }, { outOf: { KISWAHILI: 120 } });
  assert.equal(pct(p, 's1', 'Kiswahili'), Math.round((106 / 120) * 10000) / 100); assert.equal(p.outOfHints.length, 0);
});

test('junior: the English total after the two papers is English, JUMLA is Kiswahili, and the overall TOTALS is not a subject', () => {
  const p = plan({ 'GRD 7 LOVE': junior });
  assert.deepEqual(p.summary.newSubjects.sort(), ['English', 'Integrated Science', 'Kiswahili', 'Mathematics']);
  assert.equal(pct(p, 's3', 'English'), 37); assert.equal(pct(p, 's3', 'Kiswahili'), 46); assert.equal(pct(p, 's3', 'Integrated Science'), 32);
  assert.equal(p.questions.length, 0, 'no bogus question about "TOTAL"');
});

test('grades come from the class\'s own scheme', () => {
  const p = plan({ 'GRD 7 LOVE': junior });
  const eng = p.marks.find((m) => m.studentId === 's3' && m.subjectRef === 's:new:english');
  assert.deepEqual([eng.grade, eng.points], ['AE1', 4]);                                          // 37% is in the 31-40 band
});

test('a heading we cannot place is asked about; the answer releases it, "leave out" drops it, a new name adds a subject', () => {
  const ask = plan({ 'PP1 RED': pp });
  assert.deepEqual(ask.questions.map((q) => q.header), ['READING']);
  assert.equal(ask.marks.length, 2);                                                               // MATHS and LANGUAGE only
  const skip = plan({ 'PP1 RED': pp }, { answers: { READING: { skip: true } } });
  assert.equal(skip.questions.length, 0); assert.equal(skip.marks.length, 2);
  const add = plan({ 'PP1 RED': pp }, { answers: { READING: { subject: 'Reading' } } });
  assert.equal(add.questions.length, 0); assert.equal(add.marks.length, 3); assert.ok(add.summary.newSubjects.includes('Reading'));
});

test('a sheet whose class does not exist is skipped with a clear instruction, and nothing is invented', () => {
  const w = world(); w.classes = w.classes.filter((c) => c.id !== 'g7');
  const p = planMarks({ sheets: parseMarksWorkbook({ 'GRD 7 LOVE': junior }).sheets, existing: w, sections: ALL });
  assert.equal(p.marks.length, 0); assert.equal(p.summary.sheetsMissingClass, 1); assert.ok(p.skipped.some((m) => /no class called "Grade 7 Love"/.test(m)));
});

test('a school that already has a subject under another spelling reuses it', () => {
  const w = world(); w.subjects = [{ id: 'sub-m', name: 'Maths', code: null }];
  const p = planMarks({ sheets: parseMarksWorkbook({ 'GRD 4 RED': primary }).sheets, existing: w, sections: ALL });
  assert.ok(!p.summary.newSubjects.includes('Mathematics'));
  assert.ok(p.marks.some((m) => m.subjectRef === 's:sub-m'));
});

test('apply writes subjects, marks and remembered answers with real ids', async () => {
  const p = plan({ 'PP1 RED': pp }, { answers: { READING: { subject: 'Reading' } } });
  let n = 0; const calls = [];
  const client = { async query(sql, params) { calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return { rows: [{ id: `id${++n}` }] }; } };
  const out = await applyMarks(client, { organizationId: 'org', centerId: 'cen', examId: 'ex', plan: p, aliasAnswers: [{ header: 'READING', subject: 'Reading', subjectId: null }] });
  assert.equal(out.marksSaved, 3);
  for (const c of calls) assert.ok(!c.params.some((x) => x === undefined || (Array.isArray(x) && x.some((y) => y === undefined))), `undefined in: ${c.sql.slice(0, 50)}`);
  const ins = calls.find((c) => /INSERT INTO marks/.test(c.sql));
  assert.equal(ins.params[0], 'ex'); assert.equal(ins.params[1].length, 3); assert.equal(calls.filter((c) => /INSERT INTO subject_aliases/.test(c.sql)).length, 1);
});
