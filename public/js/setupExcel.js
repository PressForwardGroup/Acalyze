// Reads a school's SET-UP workbook into teachers and students. Pure: takes rows (arrays of arrays, as SheetJS's
// sheet_to_json({header:1}) gives), so it is tested without a browser or the spreadsheet library.
//
// It finds things by what the sheet CONTAINS, never by the sheet's name or position, because every school's
// workbook is laid out a little differently. Three shapes are understood:
//   1. A teachers GRID like MOHI's TEACHERS sheet: a title ("FORM 3 SUBJECT TEACHERS"), a header row
//      (STREAM, ENG, KIS, ... CLASS TRS) and one row per class with the teacher's name under each subject.
//   2. A teachers LIST: one row per teacher with Name, Phone, Email, Section, Subject, Class, Class teacher.
//   3. A students LIST: Admission No, Name, Class (or Grade + Stream), Parent name, Parent phone.
// Class sheets that carry marks (FORM 3, GRADE 10...) are read for their student roster too.
import { parseSheet } from './excel.js';

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const U = (v) => norm(v).toUpperCase();
const letters = (v) => U(v).replace(/[^A-Z]/g, '');
export const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-'/])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const YES = /^(Y|YES|TRUE|X|1|✓|✔)$/i;
const GRADE_TOKEN = /\b(?:FORM|GRADE|GRD|GR)\s*\d{1,2}\b|\bPP\s*[12]\b/i;

// "GRADE 10 SUBJECT TEACHERS", "Form 3", "GRD 7 LOVE", "PP1 RED" -> "Grade 10", "Form 3", "Grade 7", "PP1"
const WORDS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10, ELEVEN: 11, TWELVE: 12 };
// "GRADE ONE RED" -> "GRADE 1 RED" (primary sheets write the grade in words)
export const numberWords = (text) => String(text ?? '').replace(/\b(GRADE|GRD|GR|FORM)\s+(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE)\b/gi, (m, g, w) => `${g} ${WORDS[w.toUpperCase()]}`);

export function gradeOf(text) {
  const t = U(numberWords(text));
  let m = t.match(/\bFORM\s*(\d)\b/); if (m) return `Form ${m[1]}`;
  m = t.match(/\bPP\s*([12])\b/); if (m) return `PP${m[1]}`;
  m = t.match(/\b(?:GRADE|GRD|GR)\s*(\d{1,2})\b/); if (m) return `Grade ${+m[1]}`;
  return null;
}
export const cleanStream = (raw) => titleCase(norm(raw).replace(/^\d+\s*/, ''));
export const classLabel = (grade, stream) => (stream ? `${grade} ${stream}` : `${grade} (no stream)`);

// A class as written in a cell: "Form 3 East", "GRADE 4 RED", or something we cannot place ("Std 7").
export function classRef(raw, fallbackGrade = null) {
  const text = norm(numberWords(raw));
  if (!text) return null;
  const grade = gradeOf(text) || fallbackGrade;
  if (!grade) return { name: titleCase(text), grade: null, stream: null };
  const stream = cleanStream(text.replace(GRADE_TOKEN, ''));
  return { name: classLabel(grade, stream), grade, stream: stream || null };
}

// "Kipkorir/Wanjala", "Judy, Ken" -> two names. Names are title-cased: the sheets mix "zubira", "KEN", "Ken".
const splitNames = (cell) => norm(cell).split(/\s*[\/,&]\s*|\s+and\s+/i).map(norm).filter(Boolean).map(titleCase);
const splitList = (cell) => norm(cell).split(/\s*[,;\/&]\s*|\s+and\s+/i).map(norm).filter(Boolean);

function newTeacher(name) { return { name, phone: '', email: '', section: '', assignments: [], classTeacherOf: [] }; }
function mergeInto(map, t) {
  const key = t.name.toLowerCase();
  const cur = map.get(key);
  if (!cur) { map.set(key, t); return; }
  cur.phone ||= t.phone; cur.email ||= t.email; cur.section ||= t.section;
  const has = (list, x) => list.some((y) => y.className === x.className && (y.subject || '') === (x.subject || ''));
  for (const a of t.assignments) if (!has(cur.assignments, a)) cur.assignments.push(a);
  for (const c of t.classTeacherOf) if (!has(cur.classTeacherOf, c)) cur.classTeacherOf.push(c);
}

// ---------- 1. the teachers grid ----------
function readGrid(rows, sheet, teachers, notes) {
  let blocks = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    const sc = row.findIndex((c, j) => j < 4 && U(c) === 'STREAM');
    if (sc < 0) continue;
    const header = row.map((c) => norm(c));
    if (header.filter((h, j) => j > sc && h).length < 2) continue;
    let grade = null;
    for (let k = r - 1; k >= Math.max(0, r - 3) && !grade; k--) grade = gradeOf((rows[k] || []).map(norm).join(' '));
    if (!grade) { notes.push(`${sheet}: a teachers grid has no title like "FORM 3 SUBJECT TEACHERS" above it, so it was skipped.`); continue; }
    const ctCol = header.findIndex((h, j) => j > sc && /^CLASS\s*(TEACHERS?|TRS?)$/i.test(h));
    const subjectCols = header.map((h, j) => ({ h: h.replace(/\s+/g, ' '), j })).filter(({ h, j }) => j > sc && h && j !== ctCol);
    blocks++;
    for (let i = r + 1; i < rows.length; i++) {
      const d = rows[i] || [];
      const label = norm(d[sc]);
      if (!label || /TEACHERS|SUBJECT/i.test(label)) break;
      const stream = cleanStream(label);
      const ref = { className: classLabel(grade, stream), grade, stream: stream || null };
      for (const { h, j } of subjectCols) for (const name of splitNames(d[j])) {
        const t = newTeacher(name); t.assignments.push({ ...ref, subject: h }); mergeInto(teachers, t);
      }
      if (ctCol >= 0) for (const name of splitNames(d[ctCol])) { const t = newTeacher(name); t.classTeacherOf.push(ref); mergeInto(teachers, t); }
    }
  }
  return blocks;
}

// ---------- 2 & 3. lists with a header row ----------
const COLS = {
  adm: ['ADM', 'ADMNO', 'ADMISSION', 'ADMISSIONNO', 'ADMISSIONNUMBER', 'ADMNUMBER', 'REGNO', 'REGISTRATIONNO', 'REGNUMBER', 'ADMITNO'],
  name: ['NAME', 'NAMES', 'FULLNAME', 'STUDENTNAME', 'STUDENT', 'LEARNERNAME', 'LEARNER', 'TEACHER', 'TEACHERNAME', 'TEACHERSNAME'],
  phone: ['PHONE', 'PHONENO', 'PHONENUMBER', 'CONTACT', 'CONTACTS', 'TEL', 'MOBILE', 'TELEPHONE', 'TEACHERPHONE'],
  parentPhone: ['PARENTPHONE', 'PARENTCONTACT', 'GUARDIANPHONE', 'PARENTNUMBER', 'PARENTSPHONE', 'PARENTTEL', 'PHONE', 'PHONENO', 'CONTACT', 'TEL', 'MOBILE'],
  parentName: ['PARENT', 'PARENTNAME', 'GUARDIAN', 'GUARDIANNAME', 'PARENTSNAME', 'NEXTOFKIN'],
  email: ['EMAIL', 'EMAILADDRESS', 'EMAILS'],
  section: ['SECTION'],
  subject: ['SUBJECT', 'SUBJECTS', 'SUBJECTTAUGHT', 'SUBJECTSTAUGHT'],
  classes: ['CLASS', 'CLASSES', 'CLASSNAME', 'CLASSTAUGHT', 'STREAM', 'STREAMS', 'GRADE', 'FORM', 'CLASSSTREAM'],
  classTeacher: ['CLASSTEACHER', 'CLASSTEACHEROF', 'CT', 'CLASSTR', 'ISCLASSTEACHER'],
  kcpe: ['KCPE', 'KCPEMARKS'],
};
const find = (header, names) => header.findIndex((h) => names.includes(letters(h)));

function headerRow(rows, test) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const header = (rows[r] || []).map(norm);
    if (header.filter(Boolean).length >= 2 && test(header)) return { r, header };
  }
  return null;
}

function readTeacherList(rows, sheet, teachers, notes) {
  const hit = headerRow(rows, (h) => find(h, COLS.name) >= 0 && find(h, COLS.adm) < 0
    && (find(h, COLS.phone) >= 0 || find(h, COLS.email) >= 0 || find(h, COLS.subject) >= 0 || find(h, COLS.classes) >= 0 || find(h, COLS.section) >= 0));
  if (!hit) return 0;
  const { r, header } = hit;
  const c = Object.fromEntries(['name', 'phone', 'email', 'section', 'subject', 'classes', 'classTeacher'].map((k) => [k, find(header, COLS[k])]));
  let n = 0;
  for (let i = r + 1; i < rows.length; i++) {
    const d = rows[i] || [];
    const name = titleCase(norm(d[c.name]));
    if (!name || /^(NAME|TEACHER)/i.test(name)) continue;
    const t = newTeacher(name);
    if (c.phone >= 0) t.phone = norm(d[c.phone]);
    if (c.email >= 0) t.email = norm(d[c.email]).toLowerCase();
    if (c.section >= 0) t.section = U(d[c.section]);
    const classes = c.classes >= 0 ? splitList(d[c.classes]).map((x) => classRef(x)).filter(Boolean) : [];
    const subjects = c.subject >= 0 ? splitList(d[c.subject]) : [];
    for (const s of subjects) {
      if (classes.length) for (const cl of classes) t.assignments.push({ className: cl.name, grade: cl.grade, stream: cl.stream, subject: s });
      else t.assignments.push({ className: '', grade: null, stream: null, subject: s });
    }
    if (c.classTeacher >= 0 && norm(d[c.classTeacher])) {
      const v = norm(d[c.classTeacher]);
      const of = YES.test(v) ? classes : splitList(v).map((x) => classRef(x)).filter(Boolean);
      for (const cl of of) t.classTeacherOf.push({ className: cl.name, grade: cl.grade, stream: cl.stream });
    }
    mergeInto(teachers, t); n++;
  }
  return n;
}

function readStudentList(rows, sheet, students, notes) {
  const hit = headerRow(rows, (h) => find(h, COLS.name) >= 0 && find(h, COLS.adm) >= 0);
  if (!hit) return 0;
  const { r, header } = hit;
  const iAdm = find(header, COLS.adm), iName = find(header, COLS.name);
  const iClass = header.findIndex((h) => ['CLASS', 'CLASSNAME', 'CLASSSTREAM', 'GRADE', 'FORM'].includes(letters(h)));
  const iStream = header.findIndex((h) => ['STREAM', 'STRM'].includes(letters(h)));
  const iPN = find(header, COLS.parentName), iPP = find(header, COLS.parentPhone.filter((x) => x.startsWith('PARENT') || x.startsWith('GUARDIAN')));
  const iPhone = iPP >= 0 ? iPP : find(header, ['PHONE', 'PHONENO', 'CONTACT', 'TEL', 'MOBILE']);
  const iK = find(header, COLS.kcpe);
  const kind = iClass >= 0 ? letters(header[iClass]) : '';
  let n = 0;
  for (let i = r + 1; i < rows.length; i++) {
    const d = rows[i] || [];
    const name = norm(d[iName]);
    if (!name || /^(STUDENT|NAME)/i.test(name)) continue;
    let cell = iClass >= 0 ? norm(d[iClass]) : '';
    if (/^\d{1,2}$/.test(cell) && kind === 'FORM') cell = `Form ${cell}`;            // a column called FORM holding 3
    else if (/^\d{1,2}$/.test(cell) && kind === 'GRADE') cell = `Grade ${cell}`;     // a column called GRADE holding 4
    else if (/^PP\s*[12]$/i.test(cell)) cell = cell.toUpperCase();
    const stream = iStream >= 0 ? cleanStream(d[iStream]) : '';
    let ref = classRef(cell);
    if (ref && ref.grade && stream && !ref.stream) ref = { name: classLabel(ref.grade, stream), grade: ref.grade, stream };
    const kc = iK >= 0 ? Number(d[iK]) : NaN;
    students.push({
      adm: d[iAdm] == null ? '' : norm(d[iAdm]), name, className: ref?.name || '', grade: ref?.grade || null, stream: ref?.stream || null,
      parentName: iPN >= 0 ? norm(d[iPN]) : '', parentPhone: iPhone >= 0 ? norm(d[iPhone]) : '', kcpe: Number.isFinite(kc) && kc > 0 ? kc : null, sheet,
    });
    n++;
  }
  return n;
}

export function parseSetupWorkbook(sheets) {
  const teachers = new Map(), students = [], notes = [], found = [];
  const seen = new Set();
  for (const [sheet, rows] of Object.entries(sheets)) {
    const g = readGrid(rows, sheet, teachers, notes);
    if (g) { found.push({ sheet, kind: 'teachers', detail: `${g} class block${g > 1 ? 's' : ''} of teachers by subject` }); continue; }
    const tl = readTeacherList(rows, sheet, teachers, notes);
    if (tl) { found.push({ sheet, kind: 'teachers', detail: `${tl} teacher${tl > 1 ? 's' : ''} listed` }); continue; }
    const sl = readStudentList(rows, sheet, students, notes);
    if (sl) { found.push({ sheet, kind: 'students', detail: `${sl} student${sl > 1 ? 's' : ''} listed` }); continue; }
    const p = parseSheet(rows, sheet);                                       // a marks sheet: we only want its roster
    if (p && !p.skipped && p.students.length) {
      for (const s of p.students) {
        const stream = s.stream || null;
        students.push({ adm: s.adm || '', name: s.name, className: classLabel(p.level.grade, stream), grade: p.level.grade, stream, parentName: '', parentPhone: '', kcpe: s.kcpe || null, sheet });
      }
      found.push({ sheet, kind: 'students', detail: `${p.students.length} students (class sheet, marks are not imported here)` }); continue;
    }
    if (rows.some((r) => (r || []).some((c) => norm(c)))) notes.push(`Sheet "${sheet}" was not recognised as teachers or students, so it was ignored.`);
  }
  const list = [...teachers.values()];
  for (const t of list) if (t.name.split(' ').length === 1 && !t.phone && !t.email) t.firstNameOnly = true;
  if (list.length && list.every((t) => t.firstNameOnly)) notes.push('The teacher names look like first names only. Different people with the same first name will be merged into one teacher, so check the list before importing.');
  return { teachers: list, students, notes, found };
}
