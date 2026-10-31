import { gradeFor } from './grading.js';
import { bandFor } from './curriculum.js';
import { resolveSubject, normaliseKey } from './subjectResolver.js';
import { classKey, createSubjectLookup } from './setupImport.js';

// Marks from a workbook where learners are listed by NAME (see public/js/marksExcel.js). Pure, like planSetup: the preview and
// the real import use the same plan, so what you are shown is exactly what is saved.
//
// What it will NOT do is guess. A learner whose name does not match, a class that does not exist, a heading it cannot place
// and a mark above its "out of" are all reported and left out, never forced in.
//
// existing: { classes:[{id,name,grade,grading_scheme}], students:[{id,full_name,class_id}], subjects:[{id,name,code}] }
const lc = (s) => String(s ?? '').toLowerCase();
const formLevelOf = (grade) => { const m = String(grade || '').match(/(\d+)/); return m ? Number(m[1]) : null; };   // same rule as scope.js, kept here so this file needs no database
const nameTokens = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean);
const nameKey = (s) => nameTokens(s).sort().join(' ');                                     // order does not matter: "Mary Njeri" = "NJERI MARY"
const TOTAL_WORDS = new Set(['TOTAL', 'TOTALS']);
const MAX_SKIPPED = 80;

// Which learner in this class is each name on the sheet? Exact (any word order) first, then a close match: the shorter name's
// words all appear in the longer one (at least two words), and it points to exactly one learner.
export function matchLearners(rows, classStudents) {
  const byKey = new Map();
  for (const st of classStudents) { const k = nameKey(st.full_name); byKey.set(k, [...(byKey.get(k) || []), st]); }
  const result = new Map(), used = new Set(), close = [], unmatched = [], ambiguous = [];
  rows.forEach((r, i) => {
    const cand = (byKey.get(nameKey(r.name)) || []).filter((s) => !used.has(s.id));
    if (cand.length === 1) { result.set(i, cand[0]); used.add(cand[0].id); }
    else if (cand.length > 1 || (byKey.get(nameKey(r.name)) || []).length > 1) ambiguous.push(r.name);
  });
  rows.forEach((r, i) => {
    if (result.has(i) || ambiguous.includes(r.name)) return;
    const a = new Set(nameTokens(r.name));
    const hits = classStudents.filter((s) => {
      if (used.has(s.id)) return false;
      const b = new Set(nameTokens(s.full_name));
      const [small, big] = a.size <= b.size ? [a, b] : [b, a];
      return small.size >= 2 && [...small].every((t) => big.has(t));
    });
    if (hits.length === 1) { result.set(i, hits[0]); used.add(hits[0].id); close.push({ sheetName: r.name, systemName: hits[0].full_name }); }
    else unmatched.push(r.name);
  });
  return { result, close, unmatched, ambiguous };
}

export function planMarks({ sheets, existing, sections, saved = [], answers = {}, outOf = {} }) {
  const classByKey = new Map(existing.classes.map((c) => [classKey(c.name), c]));
  const lookup = createSubjectLookup({ existingSubjects: existing.subjects, sections, saved, answers });
  const answered = new Set(Object.keys(answers).map(normaliseKey));
  const skipped = [], marks = [], perSheet = [], hints = new Map();
  const skip = (m) => { if (skipped.length < MAX_SKIPPED) skipped.push(m); else if (skipped.length === MAX_SKIPPED) skipped.push('…and more'); };
  const usedSubjects = new Map();
  const seenPerClass = new Set();

  for (const sh of sheets) {
    const cls = classByKey.get(classKey(sh.className));
    if (!cls) { skip(`Sheet "${sh.sheet}": there is no class called "${sh.className}" yet. Set your classes and learners up first (Students, Set up from Excel).`); perSheet.push({ sheet: sh.sheet, className: sh.className, found: false }); continue; }
    if (seenPerClass.has(cls.id)) { skip(`Sheet "${sh.sheet}" is a second sheet for ${cls.name}, so it was left out.`); continue; }
    seenPerClass.add(cls.id);
    const classStudents = existing.students.filter((s) => s.class_id === cls.id);
    const m = matchLearners(sh.students, classStudents);

    // ---- headings: the final column for each subject, and the parts that feed it
    const band = bandFor(sh.grade || cls.name);
    const finals = new Map(), partsOnly = new Map();
    let prev = null;
    for (const col of sh.columns) {
      const nk = normaliseKey(col.header);
      let kind, subject = null;
      if (TOTAL_WORDS.has(nk) && prev?.kind === 'part') {                                                 // the "TOTAL" after the English papers
        const s = lookup.subjectFor(prev.parent, sh.grade, cls.name);
        if (s.subject) { kind = 'final'; subject = s.subject.name; col.sub = s.subject; } else kind = s.pending ? 'pending' : 'skip';
      } else {
        const r = answered.has(nk) ? null : resolveSubject(col.header, lookup.index, { band, className: sh.grade || cls.name });
        if (r?.status === 'part') { kind = 'part'; subject = r.subject; }
        else { const s = lookup.subjectFor(col.header, sh.grade, cls.name); if (s.subject) { kind = 'final'; subject = s.subject.name; col.sub = s.subject; } else kind = s.pending ? 'pending' : 'skip'; }
      }
      prev = kind === 'part' ? { kind, parent: subject } : { kind };
      col.kind = kind; col.subjectName = subject;
      if (kind === 'final') { if (finals.has(lc(subject))) skip(`${cls.name}: "${col.header}" is a second column for ${subject}; the first one is used.`); else finals.set(lc(subject), col); }
      if (kind === 'part') partsOnly.set(lc(subject), (partsOnly.get(lc(subject)) || 0) + 1);
    }
    for (const [name, n] of partsOnly) if (!finals.has(name)) skip(`${cls.name}: ${name} has ${n} part column(s) but no total column, so nothing was imported for it.`);

    // ---- marks
    let count = 0; const above = new Map();
    const scheme = cls.grading_scheme, formLevel = formLevelOf(cls.grade);
    for (const [name, col] of finals) {
      const sub = col.sub;
      if (!sub) continue;
      usedSubjects.set(sub.ref, sub);
      const max = Number(outOf[col.header]) > 0 ? Number(outOf[col.header]) : 100;
      sh.students.forEach((row, i) => {
        const v = row.values[col.key];
        const st = m.result.get(i);
        if (v == null || !st) return;
        if (v > max || v < 0) { const a = above.get(sub.name) || { n: 0, top: 0, max }; a.n++; a.top = Math.max(a.top, v); above.set(sub.name, a); const h = hints.get(col.header) || { header: col.header, subject: sub.name, max, top: 0, n: 0 }; h.n++; h.top = Math.max(h.top, v); hints.set(col.header, h); return; }
        const percent = Math.round((v / max) * 10000) / 100;
        const g = gradeFor(scheme, percent, { isScience: sub.isScience, formLevel });
        marks.push({ studentId: st.id, subjectRef: sub.ref, percent, grade: g.grade, points: g.points });
        count++;
      });
    }
    for (const [subject, a] of above) skip(`${cls.name}: ${a.n} ${subject} mark(s) are above "out of ${a.max}" (highest ${a.top}), so they were not imported. Check the paper maximums.`);
    for (const n of m.ambiguous) skip(`${cls.name}: "${n}" matches more than one learner, so their marks were not imported.`);
    perSheet.push({ sheet: sh.sheet, className: cls.name, found: true, learners: sh.students.length, matched: m.result.size, close: m.close, unmatched: m.unmatched, ambiguous: m.ambiguous.length, marks: count });
  }

  const matchedAll = perSheet.reduce((n, s) => n + (s.matched || 0), 0);
  const qList = [...lookup.questions.values()].map((q) => ({ header: q.header, status: q.status, suggestions: q.suggestions.slice(0, 4), classes: [...q.classes].filter(Boolean).slice(0, 3), count: q.count }));
  return {
    sheets: perSheet, outOfHints: [...hints.values()], marks, subjects: [...lookup.newSubjects.values()], questions: qList, skipped,
    summary: {
      sheetsRead: perSheet.filter((s) => s.found).length, sheetsMissingClass: perSheet.filter((s) => !s.found).length,
      learners: perSheet.reduce((n, s) => n + (s.learners || 0), 0), matched: matchedAll,
      closeMatches: perSheet.reduce((n, s) => n + (s.close?.length || 0), 0), unmatched: perSheet.reduce((n, s) => n + (s.unmatched?.length || 0), 0),
      marks: marks.length, newSubjects: [...lookup.newSubjects.values()].map((s) => s.name), skippedCount: skipped.filter((x) => x !== '…and more').length,
    },
  };
}

const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

export async function applyMarks(client, { organizationId, centerId, examId, plan, aliasAnswers = [] }) {
  const subjectId = {};
  for (const s of plan.subjects) {
    const r = await client.query(
      `INSERT INTO subjects (organization_id, center_id, name, code, section, is_science) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (center_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [organizationId, centerId, s.name, s.code, s.section, s.isScience]);
    subjectId[s.ref] = r.rows[0].id;
  }
  for (const m of plan.marks) if (m.subjectRef.startsWith('s:') && !m.subjectRef.startsWith('s:new:')) subjectId[m.subjectRef] = m.subjectRef.slice(2);
  let saved = 0;
  for (const part of chunks(plan.marks, 2000)) {
    await client.query(
      `INSERT INTO marks (exam_id, student_id, subject_id, grade, points, percent)
       SELECT $1::uuid, t.s, t.sub, t.g, t.p, t.pc FROM unnest($2::uuid[], $3::uuid[], $4::text[], $5::int[], $6::numeric[]) AS t(s, sub, g, p, pc)
       ON CONFLICT (exam_id, student_id, subject_id)
       DO UPDATE SET grade = EXCLUDED.grade, points = EXCLUDED.points, percent = EXCLUDED.percent, updated_at = now()`,
      [examId, part.map((m) => m.studentId), part.map((m) => subjectId[m.subjectRef]), part.map((m) => m.grade), part.map((m) => m.points), part.map((m) => m.percent)]);
    saved += part.length;
  }
  for (const a of aliasAnswers) {
    const sid = subjectId[`s:new:${lc(a.subject)}`] || a.subjectId;
    if (!sid) continue;
    await client.query(
      `INSERT INTO subject_aliases (organization_id, alias_key, alias_text, subject_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (organization_id, alias_key) DO UPDATE SET subject_id = EXCLUDED.subject_id, alias_text = EXCLUDED.alias_text`,
      [organizationId, normaliseKey(a.header), String(a.header).trim().slice(0, 80), sid]);
  }
  return { marksSaved: saved };
}
