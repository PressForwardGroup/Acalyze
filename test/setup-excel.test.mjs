import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSetupWorkbook, gradeOf, classRef } from '../public/js/setupExcel.js';

// The shape of MOHI's TEACHERS sheet: a title row, a header row, one row per class, a class-teacher column.
const grid = [
  [null, 'GRADE 10 SUBJECT TEACHERS'],
  [null, 'STREAM', 'ENG', 'KIS', 'CORE\nMAT', 'BAC', 'class teachers'],
  [null, 'NORTH', 'Barasa', 'Mukami', 'Wainaina', 'Fredrick', 'MARY'],
  [null, 'NORTHWEST', 'Nyangeri', 'Bulali', 'Chevito', 'Fredrick', 'TABITHA'],
  [null, 'FORM 3 SUBJECT TEACHERS'],
  [null, 'STREAM', 'ENG', 'KIS', 'MAT', 'HAG', 'CLASS TRS'],
  [null, '3 EAST', 'Lindah', 'Asiema', 'Wainana', 'Shalenter', 'Brian'],
  [null, '3 NORTH WEST', 'Lindah', 'Mukami', 'Korir', 'zubira', 'KORIR'],
];

test('class and grade names are read the way schools write them', () => {
  assert.equal(gradeOf('GRADE 10 SUBJECT TEACHERS'), 'Grade 10'); assert.equal(gradeOf('Form 3'), 'Form 3');
  assert.equal(gradeOf('GRD 7 LOVE'), 'Grade 7'); assert.equal(gradeOf('PP1 RED'), 'PP1'); assert.equal(gradeOf('Std 7'), null);
  assert.deepEqual(classRef('GRADE 4 RED'), { name: 'Grade 4 Red', grade: 'Grade 4', stream: 'Red' });
  assert.deepEqual(classRef('Std 7'), { name: 'Std 7', grade: null, stream: null });
});

test('a teachers grid: one teacher per name, with every class and subject they teach, and class teachers', () => {
  const r = parseSetupWorkbook({ TEACHERS: grid });
  assert.deepEqual(r.found.map((f) => f.kind), ['teachers']);
  const by = Object.fromEntries(r.teachers.map((t) => [t.name, t]));
  assert.deepEqual(Object.keys(by).sort(), ['Asiema', 'Barasa', 'Brian', 'Bulali', 'Chevito', 'Fredrick', 'Korir', 'Lindah', 'Mary', 'Mukami', 'Nyangeri', 'Shalenter', 'Tabitha', 'Wainaina', 'Wainana', 'Zubira'].sort());
  assert.deepEqual(by.Lindah.assignments.map((a) => `${a.className}|${a.subject}`), ['Form 3 East|ENG', 'Form 3 North West|ENG']);   // one person, two classes
  assert.deepEqual(by.Fredrick.assignments.map((a) => `${a.className}|${a.subject}`), ['Grade 10 North|BAC', 'Grade 10 Northwest|BAC']);
  assert.ok(by.Wainaina.assignments.some((a) => a.subject === 'CORE MAT'), 'a header split over two lines is one name');
  assert.deepEqual(by.Mary.classTeacherOf.map((c) => c.className), ['Grade 10 North']);
  assert.deepEqual(by.Korir.classTeacherOf.map((c) => c.className), ['Form 3 North West']);
  assert.equal(by.Zubira.name, 'Zubira', 'zubira and ZUBIRA are one name');
});

test('a teachers list with phone, email, subjects, classes and class teacher', () => {
  const list = [['Name', 'Phone', 'Email', 'Section', 'Subject', 'Class', 'Class teacher'],
    ['mary wanjiku', '0712345678', 'Mary@School.ac.ke', 'primary', 'Mathematics, English', 'Grade 4 Red, Grade 4 Blue', 'Grade 4 Red'],
    ['John Otieno', '0722000111', '', 'JUNIOR', 'Integrated Science', 'Grade 7 Love', 'Yes']];
  const r = parseSetupWorkbook({ Staff: list });
  assert.equal(r.teachers.length, 2);
  const m = r.teachers[0];
  assert.deepEqual([m.name, m.phone, m.email, m.section], ['Mary Wanjiku', '0712345678', 'mary@school.ac.ke', 'PRIMARY']);
  assert.equal(m.assignments.length, 4);                                                           // 2 subjects x 2 classes
  assert.deepEqual(m.classTeacherOf.map((c) => c.className), ['Grade 4 Red']);
  assert.deepEqual(r.teachers[1].classTeacherOf.map((c) => c.className), ['Grade 7 Love']);        // "Yes" means the class(es) listed
});

test('a students list: class in one column, or grade and stream in two', () => {
  const a = parseSetupWorkbook({ S: [['Admission No', 'Name', 'Class', 'Stream', 'Parent name', 'Parent phone', 'KCPE'],
    ['A001', 'Amina Hassan', 'Grade 4', 'Red', 'Fatuma', '0711222333', ''], ['A002', 'Brian Mutua', 'Form 3', 'north east', '', '', 301]] });
  assert.deepEqual(a.found.map((f) => f.kind), ['students']);
  assert.deepEqual(a.students.map((s) => s.className), ['Grade 4 Red', 'Form 3 North East']);
  assert.deepEqual([a.students[0].parentName, a.students[0].parentPhone, a.students[1].kcpe], ['Fatuma', '0711222333', 301]);
  const b = parseSetupWorkbook({ S: [['ADM NO', 'STUDENT NAME', 'CLASS'], ['9', 'Eve', 'GRADE 6 BLUE']] });
  assert.equal(b.students[0].className, 'Grade 6 Blue');
  const c = parseSetupWorkbook({ S: [['Adm', 'Name', 'Form'], ['1', 'Sam', '4']] });
  assert.equal(c.students[0].className, 'Form 4 (no stream)');
});

test('a teachers list is not mistaken for a students list, and nothing is guessed from unknown sheets', () => {
  const r = parseSetupWorkbook({ T: [['Name', 'Phone'], ['Ann Mwangi', '0700']], Notes: [['Remember to bring the registers']] });
  assert.equal(r.teachers.length, 1); assert.equal(r.students.length, 0);
  assert.ok(r.notes.some((n) => /Notes/.test(n)), 'the unknown sheet is mentioned, not silently dropped');
});

test('a grid with no grade in its title is skipped with a reason', () => {
  const r = parseSetupWorkbook({ T: [[null, 'STREAM', 'ENG', 'KIS'], [null, 'A', 'Ann', 'Bob']] });
  assert.equal(r.teachers.length, 0); assert.ok(r.notes.some((n) => /title/.test(n)));
});
