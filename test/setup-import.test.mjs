import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSetupWorkbook } from '../public/js/setupExcel.js';
import { planSetup, applySetup, classKey } from '../src/lib/setupImport.js';
import { planImport } from '../src/lib/importer.js';

const ALL = ['PRIMARY', 'JUNIOR', 'SENIOR'];
const empty = () => ({ classes: [], subjects: [], teachers: [], students: [] });
const grid = [
  [null, 'FORM 3 SUBJECT TEACHERS'], [null, 'STREAM', 'ENG', 'MAT', 'HAG', 'COM', 'CLASS TRS'],
  [null, '3 EAST', 'Lindah', 'Wainana', 'Shalenter', 'Ken', 'Brian'], [null, '3 WEST', 'Purity', 'Masika', 'Zubira', 'Ken', 'Wanjala'],
  [null, 'GRADE 10 SUBJECT TEACHERS'], [null, 'STREAM', 'ENG', 'CORE\nMAT', 'BAC', 'class teachers'],
  [null, 'NORTH', 'Barasa', 'Wainaina', 'Fredrick', 'MARY'],
];
const plan = (wb, extra = {}) => { const p = parseSetupWorkbook(wb); return planSetup({ teachers: p.teachers, students: p.students, existing: empty(), sections: ALL, ...extra }); };

test('the TEACHERS grid becomes classes, subjects, teachers, assignments and class teachers', () => {
  const r = plan({ TEACHERS: grid });
  assert.deepEqual(r.summary.newClasses.sort(), ['Form 3 East', 'Form 3 West', 'Grade 10 North']);
  assert.ok(r.summary.newSubjects.includes('History and Government') && r.summary.newSubjects.includes('Computer Studies') && r.summary.newSubjects.includes('Core Mathematics'));
  const hag = r.subjects.find((s) => s.name === 'History and Government');
  assert.deepEqual([hag.code, hag.section], ['311', 'SENIOR']);                                    // codes come from the KNEC list
  assert.equal(r.summary.classTeachers, 3);
  assert.equal(r.summary.teachersNew, 13);
  assert.equal(r.assignments.length, 4 * 2 + 2, 'four subjects in each Form 3 class, two in Grade 10; BAC is held back until answered');
});

test('a subject name we cannot be sure of is asked about, not guessed, and its assignments wait', () => {
  const r = plan({ TEACHERS: grid });
  assert.equal(r.questions.length, 1);
  assert.deepEqual([r.questions[0].header, r.questions[0].status], ['BAC', 'unknown']);
  assert.equal(r.summary.pendingAssignments, 1);
  assert.ok(!r.teacherSubjects.some((t) => t.teacherRef.endsWith('fredrick')), 'nothing was assigned for the unanswered subject');
});

test('answering once releases the held assignments; "leave out" drops them', () => {
  const a = plan({ TEACHERS: grid }, { answers: { BAC: { subject: 'Building Construction' } } });
  assert.equal(a.questions.length, 0); assert.equal(a.summary.pendingAssignments, 0);
  assert.ok(a.assignments.some((x) => x.teacherRef.endsWith('fredrick')));
  const b = plan({ TEACHERS: grid }, { answers: { BAC: { skip: true } } });
  assert.equal(b.questions.length, 0); assert.ok(!b.assignments.some((x) => x.teacherRef.endsWith('fredrick')));
});

test('a saved answer from an earlier import is used without asking again', () => {
  const r = plan({ TEACHERS: grid }, { saved: [{ alias: 'BAC', subject: 'Building Construction' }] });
  assert.equal(r.questions.length, 0);
});

test('what the school already has is reused: classes spelled differently, subjects under another name, teachers by name', () => {
  const existing = { classes: [{ id: 'c1', name: 'Form 3 East', section: 'SENIOR' }], subjects: [{ id: 's1', name: 'Maths', code: null }, { id: 's2', name: 'English', code: null }],
    teachers: [{ id: 't1', full_name: 'Lindah', phone: null, email: null }], students: [] };
  const p = parseSetupWorkbook({ TEACHERS: grid });
  const r = planSetup({ teachers: p.teachers, students: [], existing, sections: ALL });
  assert.ok(!r.summary.newClasses.includes('Form 3 East'));
  assert.ok(!r.summary.newSubjects.includes('Mathematics') && !r.summary.newSubjects.includes('English'), '"Maths" is the school\'s Mathematics');
  assert.equal(r.summary.teachersExisting, 1);
  assert.equal(classKey('Form 3 North West'), classKey('FORM 3 NORTHWEST'));
});

test('a school that does not use a section never gets classes or teachers in it', () => {
  const r = plan({ TEACHERS: grid }, { sections: ['PRIMARY'] });
  assert.equal(r.summary.newClasses.length, 0); assert.equal(r.teachers.length, 0);
  assert.ok(r.skipped.some((m) => /SENIOR section, which your school does not use/.test(m)));
});

test('teacher details: bad or shared emails are dropped with a note, existing teachers only gain missing details', () => {
  const list = [['Name', 'Phone', 'Email', 'Section'], ['Ann Mwangi', '0700', 'not-an-email', 'PRIMARY'], ['Bob Kamau', '0701', 'bob@x.ac.ke', 'PRIMARY'], ['Cy Oloo', '0702', 'bob@x.ac.ke', 'PRIMARY']];
  const p = parseSetupWorkbook({ T: list });
  const r = planSetup({ teachers: p.teachers, students: [], existing: empty(), sections: ALL });
  const by = Object.fromEntries(r.teachers.map((t) => [t.name, t]));
  assert.equal(by['Ann Mwangi'].email, ''); assert.equal(by['Bob Kamau'].email, 'bob@x.ac.ke'); assert.equal(by['Cy Oloo'].email, '');
  assert.equal(r.skipped.length, 2);
});

test('students: new, existing, moved; no admission number or a repeat is skipped; classes are created from grade and stream', () => {
  const students = [
    { adm: 'A1', name: 'Amina', className: 'Grade 4 Red', grade: 'Grade 4', stream: 'Red', parentPhone: '0711' },
    { adm: 'A2', name: 'Brian', className: 'Grade 4 Red', grade: 'Grade 4', stream: 'Red' },
    { adm: 'A3', name: 'Cate', className: 'Grade 4 Blue', grade: 'Grade 4', stream: 'Blue' },
    { adm: '', name: 'No Number', className: 'Grade 4 Red', grade: 'Grade 4', stream: 'Red' },
    { adm: 'a1', name: 'Repeat', className: 'Grade 4 Red', grade: 'Grade 4', stream: 'Red' },
    { adm: 'A9', name: 'Lost', className: 'Std 7', grade: null, stream: null },
  ];
  const existing = { ...empty(), classes: [{ id: 'c9', name: 'Grade 4 Blue', section: 'PRIMARY' }], students: [{ id: 'st3', school_id_number: 'A3', class_id: 'c-other' }] };
  const r = planSetup({ teachers: [], students, existing, sections: ALL });
  assert.deepEqual(r.summary.newClasses, ['Grade 4 Red']);
  assert.deepEqual([r.summary.studentsNew, r.summary.studentsExisting, r.summary.studentsMoved], [3, 1, 1]);
  assert.equal(r.students.find((s) => s.adm === 'A9').classRef, null);
  assert.ok(r.skipped.some((m) => /No Number.*no admission number/.test(m)) && r.skipped.some((m) => /Repeat.*already used/.test(m)) && r.skipped.some((m) => /Std 7/.test(m)));
});

test('apply writes everything with real ids, and parent details come back for linking', async () => {
  const p = parseSetupWorkbook({ TEACHERS: grid });
  const students = [{ adm: 'A1', name: 'Sam', className: 'Form 3 East', grade: 'Form 3', stream: 'East', parentName: 'Mum', parentPhone: '0711' }];
  const pl = planSetup({ teachers: p.teachers, students, existing: empty(), sections: ALL, answers: { BAC: { subject: 'Building Construction' } } });
  let n = 0; const calls = [];
  const client = { async query(sql, params) {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    if (/INSERT INTO students/.test(sql)) return { rows: params[2].map((a) => ({ id: `stu-${a}`, school_id_number: a })) };
    return { rows: [{ id: `id${++n}` }] };
  } };
  const out = await applySetup(client, { organizationId: 'org', centerId: 'cen', plan: pl, aliasAnswers: [{ header: 'BAC', subject: 'Building Construction', subjectId: null }] });
  assert.deepEqual(out.created, [{ id: 'stu-A1', name: 'Sam', parentName: 'Mum', parentPhone: '0711' }]);
  for (const c of calls) assert.ok(!c.params.some((x) => x === undefined || (Array.isArray(x) && x.some((y) => y === undefined))), `undefined id in: ${c.sql.slice(0, 60)}`);
  const count = (re) => calls.filter((c) => re.test(c.sql)).length;
  assert.equal(count(/INSERT INTO classes/), 3); assert.equal(count(/INSERT INTO teacher_assignments/), pl.assignments.length);
  assert.equal(count(/INSERT INTO class_teachers/), 3); assert.equal(count(/INSERT INTO subject_aliases/), 1);
  const stu = calls.find((c) => /INSERT INTO students/.test(c.sql));
  assert.ok(stu.params[4][0], 'the student is placed in the class created in the same import');
});

test('the marks importer reuses a class made here even if the stream is spelled differently', () => {
  const existing = { classes: [{ id: 'c1', name: 'Grade 10 Northwest' }], subjects: [], students: [] };
  const sheet = { name: 'GRADE 10', level: { scheme: 'cbc', grade: 'Grade 10', number: 10, section: 'SENIOR' }, subjects: [], students: [{ name: 'A', adm: '1', stream: 'North West', marks: {} }] };
  const r = planImport({ sheets: [sheet], existing, importMarks: false });
  assert.equal(r.summary.newClasses.length, 0);
});
