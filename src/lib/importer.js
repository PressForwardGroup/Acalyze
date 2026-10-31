import { gradeFor, isScienceSubject } from './grading.js';
import { classKey } from './setupImport.js';

// Turns a parsed workbook (see public/js/excel.js) into a plan of what to create
// and save, WITHOUT touching the database. The preview ("Check") and the real
// import both use this, so what you are shown is exactly what gets written.
//
// existing: { classes:[{id,name}], subjects:[{id,name,code}], students:[{id,school_id_number,class_id}] }
const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const lc = (s) => s.toLowerCase();
const MAX_SKIPPED = 60;

export function planImport({ sheets, existing, importMarks = true }) {
  const classByName = new Map(existing.classes.map((c) => [classKey(c.name), c]));      // "North West" and "Northwest" are the same class
  const subjByName = new Map(existing.subjects.map((s) => [lc(s.name), s]));
  const subjByCode = new Map(existing.subjects.filter((s) => s.code).map((s) => [String(s.code), s]));
  const studentByAdm = new Map(existing.students.map((s) => [lc(s.school_id_number), s]));

  const classes = new Map(), subjects = new Map(), students = [], marks = [], skipped = [];
  const seenAdm = new Map();
  const skip = (msg) => { if (skipped.length < MAX_SKIPPED) skipped.push(msg); else if (skipped.length === MAX_SKIPPED) skipped.push('…and more'); };
  let skippedMarks = 0;

  for (const sheet of sheets) {
    const lv = sheet.level;
    if (!lv || !['844', 'cbc'].includes(lv.scheme) || !lv.grade) { skip(`Sheet "${clean(sheet.name, 40)}" skipped: unknown class level.`); continue; }
    const grade = clean(lv.grade, 30), formLevel = Number(lv.number) || null;

    // subjects in this sheet -> existing or new
    const subjRef = {};
    for (const sub of sheet.subjects || []) {
      const name = clean(sub.name, 80), code = clean(sub.code, 10);
      if (!name) continue;
      let found = subjByName.get(lc(name)) || (code ? subjByCode.get(code) : null) || subjects.get(lc(name));
      if (!found) { found = { ref: `s:${lc(name)}`, id: null, name, code, isScience: isScienceSubject({ name, code }), isNew: true }; }
      else if (!found.ref) found = { ref: `s:${found.id}`, id: found.id, name: found.name, code: found.code, isScience: isScienceSubject({ name: found.name, code: found.code }), isNew: false };
      subjects.set(lc(found.name), found); subjRef[sub.key] = found;
    }

    for (const st of sheet.students || []) {
      const name = clean(st.name, 120), adm = clean(st.adm, 40);
      if (!name) continue;
      if (!adm) { skip(`${name} (${grade}): no admission number, skipped.`); continue; }
      const prior = seenAdm.get(lc(adm));
      if (prior) { skip(`${name} (${grade}): admission number ${adm} is already used by ${prior}, skipped.`); continue; }
      seenAdm.set(lc(adm), `${name} (${grade})`);

      const stream = clean(st.stream, 40);
      const className = stream ? `${grade} ${stream}` : `${grade} (no stream)`;
      let cls = classByName.get(classKey(className)) || classes.get(classKey(className));
      if (!cls) cls = { ref: `c:${lc(className)}`, id: null, name: className, grade, stream: stream || null, section: lv.section, scheme: lv.scheme, isNew: true };
      else if (!cls.ref) cls = { ref: `c:${cls.id}`, id: cls.id, name: cls.name, isNew: false };
      classes.set(classKey(className), cls);

      const ex = studentByAdm.get(lc(adm));
      const kcpe = Number(st.kcpe) > 0 && Number(st.kcpe) <= 500 ? Math.round(Number(st.kcpe)) : null;
      students.push({ adm, name, classRef: cls.ref, classId: cls.id, kcpe, existingId: ex?.id || null, moved: !!ex && ex.class_id !== cls.id });

      if (!importMarks) continue;
      for (const [key, raw] of Object.entries(st.marks || {})) {
        const sub = subjRef[key]; const v = Number(raw);
        if (!sub || !Number.isFinite(v) || v < 0) continue;
        const outOf = Number(sheet.outOf?.[key]) > 0 ? Number(sheet.outOf[key]) : 100;
        if (v > outOf) { skippedMarks++; skip(`${name}: ${sub.name} score ${v} is above "out of ${outOf}", not imported.`); continue; }
        const percent = Math.round((v / outOf) * 10000) / 100;
        const g = gradeFor(lv.scheme, percent, { isScience: sub.isScience, formLevel });
        marks.push({ adm, subjectRef: sub.ref, percent, grade: g.grade, points: g.points });
      }
    }
  }

  const classList = [...classes.values()], subjectList = [...subjects.values()];
  return {
    classes: classList, subjects: subjectList, students, marks, skipped,
    summary: {
      newClasses: classList.filter((c) => c.isNew).map((c) => c.name),
      newSubjects: subjectList.filter((s) => s.isNew).map((s) => s.name),
      studentsNew: students.filter((s) => !s.existingId).length,
      studentsExisting: students.filter((s) => s.existingId).length,
      studentsMoved: students.filter((s) => s.moved).length,
      marks: marks.length, skippedCount: skipped.filter((m) => m !== '…and more').length, skippedMarks,
    },
  };
}

const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// Writes a plan inside the caller's transaction (client = a checked-out pg client).
export async function applyImport(client, { organizationId, centerId, examId, plan }) {
  const classId = {}, subjectId = {};
  for (const c of plan.classes) {
    if (c.id) { classId[c.ref] = c.id; continue; }
    const r = await client.query(
      `INSERT INTO classes (organization_id, center_id, name, grade, stream, section, grading_scheme)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [organizationId, centerId, c.name, c.grade, c.stream, c.section, c.scheme]);
    classId[c.ref] = r.rows[0].id;
  }
  for (const s of plan.subjects) {
    if (s.id) { subjectId[s.ref] = s.id; continue; }
    const r = await client.query(
      `INSERT INTO subjects (organization_id, center_id, name, code, is_science) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [organizationId, centerId, s.name, s.code || null, s.isScience]);
    subjectId[s.ref] = r.rows[0].id;
  }

  const studentId = {};
  const fresh = plan.students.filter((s) => !s.existingId), known = plan.students.filter((s) => s.existingId);
  for (const part of chunks(fresh, 1000)) {
    const r = await client.query(
      `INSERT INTO students (organization_id, center_id, school_id_number, full_name, class_id, kcpe_marks)
       SELECT $1::uuid, $2::uuid, t.a, t.n, t.c, t.k FROM unnest($3::text[], $4::text[], $5::uuid[], $6::int[]) AS t(a, n, c, k)
       RETURNING id, school_id_number`,
      [organizationId, centerId, part.map((s) => s.adm), part.map((s) => s.name), part.map((s) => classId[s.classRef]), part.map((s) => s.kcpe)]);
    for (const row of r.rows) studentId[row.school_id_number.toLowerCase()] = row.id;
  }
  for (const part of chunks(known, 1000)) {
    await client.query(
      `UPDATE students s SET class_id = t.c, center_id = $2::uuid, kcpe_marks = COALESCE(t.k, s.kcpe_marks)
       FROM unnest($3::uuid[], $4::uuid[], $5::int[]) AS t(id, c, k) WHERE s.id = t.id AND s.organization_id = $1::uuid`,
      [organizationId, centerId, part.map((s) => s.existingId), part.map((s) => classId[s.classRef]), part.map((s) => s.kcpe)]);
    for (const s of part) studentId[s.adm.toLowerCase()] = s.existingId;
  }

  let saved = 0;
  if (examId) {
    for (const part of chunks(plan.marks, 2000)) {
      await client.query(
        `INSERT INTO marks (exam_id, student_id, subject_id, grade, points, percent)
         SELECT $1::uuid, t.s, t.sub, t.g, t.p, t.pc FROM unnest($2::uuid[], $3::uuid[], $4::text[], $5::int[], $6::numeric[]) AS t(s, sub, g, p, pc)
         ON CONFLICT (exam_id, student_id, subject_id)
         DO UPDATE SET grade = EXCLUDED.grade, points = EXCLUDED.points, percent = EXCLUDED.percent, updated_at = now()`,
        [examId, part.map((m) => studentId[m.adm.toLowerCase()]), part.map((m) => subjectId[m.subjectRef]), part.map((m) => m.grade), part.map((m) => m.points), part.map((m) => m.percent)]);
      saved += part.length;
    }
  }
  return { marksSaved: saved };
}
