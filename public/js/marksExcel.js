// Reads a class-by-class marks workbook where learners are listed by NAME only (no admission numbers), the way many
// primary and junior schools keep their exam sheets: one sheet per stream, a title line ("GRADE FOUR RED  TR. KELVIN"),
// a header row (NAME, MATHS, GRAMMAR, READING, ENGLISH, ... TOTAL, MEAN, GRADE) and one row per learner.
// Pure: takes rows (arrays of arrays), so it is tested without a browser.
//
// This only READS. Which class it is, which subject each heading means, and who each learner is are decided on the
// server (src/lib/marksImport.js), against the school's own classes, subjects and students.
import { numberWords, gradeOf, classLabel, cleanStream, titleCase } from './setupExcel.js';

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const U = (v) => norm(v).toUpperCase();
const NOT_A_LEARNER = /^(MEAN|TOTALS?|AVERAGE|SUBJECT|POSITION|KEY|NOTE|STUDENT|NAMES?)\b/i;

// "GRADE FOUR RED   TR.KELVIN MACHARIA" -> { grade: "Grade 4", stream: "Red" }; the teacher's name after "TR" is dropped.
export function classOfTitle(text) {
  const t = norm(numberWords(text)).split(/\bTR\b\.?/i)[0];
  const grade = gradeOf(t);
  if (!grade) return null;
  const rest = t.replace(/\b(?:FORM|GRADE|GRD|GR)\s*\d{1,2}\b|\bPP\s*[12]\b/i, '');
  const stream = cleanStream(rest.replace(/[^A-Za-z ]/g, ' '));
  return { grade, stream: stream || null, className: classLabel(grade, stream || null) };
}

// A mark as typed: 86, "86", "86.5". Anything else ("ABS", "-", "", "x") is no mark, and is counted so the preview can say so.
export function markOf(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = norm(v).replace(/,/g, '');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

function readSheet(rows, sheet) {
  const hr = rows.findIndex((r, i) => i < 12 && (r || []).some((c) => U(c) === 'MEAN') && (r || []).filter((c) => norm(c)).length >= 5);
  if (hr < 0) return { sheet, skipped: 'no header row with a MEAN column was found' };
  const header = rows[hr].map(norm);
  if (header.some((h) => /^(ADM|ADMNO|ADMISSION)/i.test(h.replace(/[^A-Za-z]/g, '')))) return { sheet, skipped: 'it has admission numbers; use "Import marks from Excel" for sheets like that' };
  const meanCol = header.findIndex((h) => h.toUpperCase() === 'MEAN');
  let nameCol = header.findIndex((h) => /NAME/i.test(h));
  if (nameCol < 0) nameCol = header.findIndex((h) => /^(GRADE|GRD|PP)\s*\d/i.test(numberWords(h)));        // the class title sits where "NAME" would
  if (nameCol < 0) nameCol = 1;
  let totalCol = -1;
  header.forEach((h, j) => { if (j < meanCol && /^TOTALS?$/i.test(h)) totalCol = j; });                    // the LAST total before MEAN is the overall one
  const stop = totalCol >= 0 ? totalCol : meanCol;
  const columns = [], unnamed = [];
  for (let j = nameCol + 1; j < stop; j++) {
    if (header[j]) columns.push({ key: String(j), header: header[j] });
    else if (rows.slice(hr + 1).some((r) => markOf((r || [])[j]) != null)) unnamed.push(j);
  }

  let exam = '', title = '';
  for (let i = 0; i < hr; i++) {
    const text = (rows[i] || []).map(norm).filter(Boolean).join(' ');
    if (!text) continue;
    if (!exam && /\b(EXAM|EXAMS|TERM|TEST|CAT)\b/i.test(text) && !classOfTitle(text)) exam = text;
    if (!title && classOfTitle(text)) title = text;
  }
  const cls = classOfTitle(title) || classOfTitle(sheet);
  const students = []; let absent = 0;
  for (let i = hr + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name = norm(r[nameCol]);
    if (!name || /^\d+$/.test(name) || NOT_A_LEARNER.test(name)) continue;
    const values = {};
    for (const c of columns) {
      const raw = r[Number(c.key)];
      const v = markOf(raw);
      if (v != null) values[c.key] = v; else if (norm(raw)) absent++;
    }
    students.push({ name, values });
  }
  return { sheet, exam, title: norm(title.split(/\bTR\b\.?/i)[0]), className: cls?.className || '', grade: cls?.grade || null, stream: cls?.stream || null, columns, students, absent, unnamed: unnamed.length };
}

export function parseMarksWorkbook(sheets) {
  const out = [], notes = [];
  for (const [name, rows] of Object.entries(sheets)) {
    if (/COMBINED/i.test(name)) { notes.push(`"${norm(name)}" is a combined copy of the streams, so it was left out. Positions across a grade are worked out for you.`); continue; }
    if (!(rows || []).some((r) => (r || []).some((c) => norm(c)))) continue;
    const s = readSheet(rows, norm(name));
    if (s.skipped) { notes.push(`Sheet "${norm(name)}" was skipped: ${s.skipped}.`); continue; }
    if (!s.className) { notes.push(`Sheet "${norm(name)}": the class could not be worked out from its title, so it was skipped.`); continue; }
    if (!s.students.length) { notes.push(`Sheet "${norm(name)}" has no learners with marks.`); continue; }
    if (s.unnamed) notes.push(`Sheet "${norm(name)}": ${s.unnamed} column(s) with marks but no heading were ignored. Add a heading to import them.`);
    out.push(s);
  }
  const same = (a) => a.toUpperCase().replace(/[^A-Z0-9]/g, '');                                   // "END-TERM" and "END TERM" are the same
  const counts = {};
  for (const s of out) if (s.exam) counts[same(s.exam)] = (counts[same(s.exam)] || 0) + 1;
  const main = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const s of out) if (s.exam && main && same(s.exam) !== main) notes.push(`Sheet "${s.sheet}" says "${s.exam}", but most sheets say "${out.find((x) => same(x.exam) === main).exam}". Check it is the same exam.`);
  return { sheets: out, exam: main ? out.find((x) => same(x.exam) === main).exam : '', notes };
}
export { titleCase };
