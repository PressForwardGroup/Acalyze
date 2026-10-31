import { bandFor, BAND_SECTION, catalogueFor, codeFor } from './curriculum.js';
import { buildIndex, resolveSubject, normaliseKey } from './subjectResolver.js';

// Turns the teachers and students read from a workbook (public/js/setupExcel.js) into a plan of what to create,
// WITHOUT touching the database. The preview ("Check") and the real import both use this, so what you are shown
// is exactly what gets written.
//
// existing: { classes:[{id,name}], subjects:[{id,name,code}], teachers:[{id,full_name,phone,email}], students:[{id,school_id_number,class_id}] }
// sections: the sections this school uses.   saved: [{alias, subject}] answers given before.
// answers:  { "<subject header>": { subject: "<name>" } | { skip: true } } given in this session.
const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const lc = (s) => String(s ?? '').toLowerCase();
export const classKey = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');   // "Form 3 North West" == "FORM 3 NORTHWEST"
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SKIPPED = 80;

function levelFor(grade) {
  const band = bandFor(grade);
  return band ? { band, section: BAND_SECTION[band], scheme: band === '844' ? '844' : 'cbc' } : null;
}

// Subjects: names are resolved with the short-name matcher, never guessed. Used by every import that meets subject names.
//   subjectFor(header, grade, className) -> { subject } (existing, or new from the KNEC/KICD list) | { pending } (a question was recorded)
//                                           | { skipped } (the person chose to leave it out)
export function createSubjectLookup({ existingSubjects, sections, saved = [], answers = {} }) {
  const subjByName = new Map(existingSubjects.map((s) => [lc(s.name), s]));
  const catalogue = new Map(catalogueFor(sections).map((r) => [lc(r.name), r]));
  const index = buildIndex({ sections, saved });
  const existingByCanon = new Map();                                  // "mathematics" -> the school's own "Maths"
  for (const s of existingSubjects) { const r = resolveSubject(s.name, index, {}); if (r.status === 'matched' && !existingByCanon.has(lc(r.subject))) existingByCanon.set(lc(r.subject), s); }
  const answerByKey = new Map(Object.entries(answers).map(([h, a]) => [normaliseKey(h), a]));
  const newSubjects = new Map(), questions = new Map();

  function subjectFor(header, grade, className) {
    const band = bandFor(grade || className);
    const key = normaliseKey(header);
    const ans = answerByKey.get(key);
    let name = null;
    if (ans?.skip) return { skipped: true };
    if (ans?.subject) name = ans.subject;
    else {
      const r = resolveSubject(header, index, { band, className: grade || className });
      if (r.status === 'matched' || r.status === 'part') name = r.subject;
      else {
        const q = questions.get(`${key}|${band || ''}`) || { header: clean(header, 40), status: r.status, suggestions: r.suggestions?.length ? r.suggestions : (r.subject ? [r.subject] : []), classes: new Set(), count: 0 };
        if (r.status === 'suggested' && r.subject && !q.suggestions.includes(r.subject)) q.suggestions.unshift(r.subject);
        q.classes.add(grade || className || ''); q.count++;
        questions.set(`${key}|${band || ''}`, q);
        return { pending: true };
      }
    }
    let s = subjByName.get(lc(name)) || existingByCanon.get(lc(name)) || newSubjects.get(lc(name));
    if (!s) {
      const cat = catalogue.get(lc(name));
      s = { ref: `s:new:${lc(name)}`, id: null, name: cat?.name || name, code: cat?.code || null, section: cat?.section ?? null, isScience: !!cat?.isScience, isNew: true };
      newSubjects.set(lc(name), s);
    } else if (!s.ref) s = { ref: `s:${s.id}`, id: s.id, name: s.name, isNew: false };
    return { subject: s };
  }
  return { subjectFor, newSubjects, questions, index };
}

export function planSetup({ teachers = [], students = [], existing, sections, saved = [], answers = {} }) {
  const classByKey = new Map(existing.classes.map((c) => [classKey(c.name), c]));
  const teacherByName = new Map(existing.teachers.map((t) => [lc(t.full_name), t]));
  const studentByAdm = new Map(existing.students.map((s) => [lc(s.school_id_number), s]));
  const usedEmails = new Set(existing.teachers.map((t) => lc(t.email)).filter(Boolean));
  const { subjectFor, newSubjects, questions } = createSubjectLookup({ existingSubjects: existing.subjects, sections, saved, answers });

  const skipped = [];
  const skip = (msg) => { if (skipped.length < MAX_SKIPPED) skipped.push(msg); else if (skipped.length === MAX_SKIPPED) skipped.push('…and more'); };
  const newClasses = new Map(), blockedBySection = new Set();

  // ---- classes: an existing one, or one to create (only when we know the grade, and the school uses its section)
  function classFor(ref) {
    if (!ref?.name) return null;
    const key = classKey(ref.name);
    const have = classByKey.get(key);
    if (have) return { ref: `c:${have.id}`, id: have.id, name: have.name, section: have.section || null };
    if (newClasses.has(key)) return newClasses.get(key);
    const lv = ref.grade ? levelFor(ref.grade) : null;
    if (!lv) { skip(`Class "${ref.name}": not found, and it has no Form or Grade number to create it from.`); newClasses.set(key, null); return null; }
    if (!sections.includes(lv.section)) { skip(`Class "${ref.name}" is in the ${lv.section} section, which your school does not use.`); blockedBySection.add(key); newClasses.set(key, null); return null; }
    const c = { ref: `c:new:${key}`, id: null, name: ref.name, grade: ref.grade, stream: ref.stream || null, section: lv.section, scheme: lv.scheme, band: lv.band, isNew: true };
    newClasses.set(key, c);
    return c;
  }

  // ---- teachers
  const teacherPlans = [], assignments = [], classTeachers = [], teacherSubjects = new Set();
  const seenName = new Set();
  let pendingAssignments = 0, firstNameOnly = 0;
  for (const t of teachers) {
    const name = clean(t.name, 120);
    if (!name) continue;
    if (seenName.has(lc(name))) continue;
    seenName.add(lc(name));
    if (!name.includes(' ')) firstNameOnly++;
    const have = teacherByName.get(lc(name));
    let email = lc(clean(t.email, 120));
    if (email && !EMAIL_RE.test(email)) { skip(`${name}: "${t.email}" is not a valid email, so it was not saved.`); email = ''; }
    if (email && usedEmails.has(email) && !(have && lc(have.email) === email)) { skip(`${name}: email ${email} is already used by another login, so it was not saved.`); email = ''; }
    if (email) usedEmails.add(email);
    const tp = { ref: have ? `t:${have.id}` : `t:new:${lc(name)}`, id: have?.id || null, name: have?.full_name || name, phone: clean(t.phone, 40), email, isNew: !have, section: '' };

    const classSections = [], myAssign = [], myCT = [], mySubj = [], refKeys = [];
    for (const a of t.assignments || []) {
      const cls = a.className ? classFor({ name: a.className, grade: a.grade, stream: a.stream }) : null;
      if (a.className) refKeys.push(classKey(a.className));
      if (cls) classSections.push(cls.section);
      const sub = subjectFor(a.subject, a.grade, a.className);
      if (sub.pending) { pendingAssignments++; continue; }
      if (sub.skipped || !sub.subject) continue;
      mySubj.push(`${tp.ref}|${sub.subject.ref}`);
      if (cls) myAssign.push({ teacherRef: tp.ref, classRef: cls.ref, subjectRef: sub.subject.ref });
    }
    for (const c of t.classTeacherOf || []) {
      const cls = classFor({ name: c.className, grade: c.grade, stream: c.stream });
      refKeys.push(classKey(c.className));
      if (cls) { classSections.push(cls.section); myCT.push({ teacherRef: tp.ref, classRef: cls.ref }); }
    }
    if (refKeys.length && refKeys.every((k) => blockedBySection.has(k))) { skip(`${name}: all their classes are in sections your school does not use, so this teacher was skipped.`); continue; }
    const given = ['PRIMARY', 'JUNIOR', 'SENIOR'].includes(t.section) ? t.section : '';
    tp.section = given || classSections.find(Boolean) || sections[0];
    if (!sections.includes(tp.section)) { skip(`${name}: the ${tp.section} section is not used by your school, so this teacher was skipped.`); continue; }
    teacherPlans.push(tp);
    assignments.push(...myAssign); classTeachers.push(...myCT); mySubj.forEach((k) => teacherSubjects.add(k));
  }

  // ---- students
  const studentPlans = [], seenAdm = new Map();
  for (const st of students) {
    const name = clean(st.name, 120), adm = clean(st.adm, 40);
    if (!name) continue;
    if (!adm) { skip(`${name}: no admission number, skipped.`); continue; }
    const prior = seenAdm.get(lc(adm));
    if (prior) { skip(`${name}: admission number ${adm} is already used by ${prior}, skipped.`); continue; }
    seenAdm.set(lc(adm), name);
    const cls = st.className ? classFor({ name: st.className, grade: st.grade, stream: st.stream }) : null;
    if (st.className && !cls) skip(`${name}: class "${st.className}" could not be found or created, so the student is added with no class.`);
    const ex = studentByAdm.get(lc(adm));
    const kcpe = Number(st.kcpe) > 0 && Number(st.kcpe) <= 500 ? Math.round(Number(st.kcpe)) : null;
    studentPlans.push({ adm, name, classRef: cls?.ref || null, classId: cls?.id || null, kcpe, parentName: clean(st.parentName, 120), parentPhone: clean(st.parentPhone, 40),
      existingId: ex?.id || null, moved: !!ex && !!cls && ex.class_id !== cls.id });
  }

  const classList = [...newClasses.values()].filter(Boolean);
  const qList = [...questions.values()].map((q) => ({ header: q.header, status: q.status, suggestions: q.suggestions.slice(0, 4), classes: [...q.classes].filter(Boolean).slice(0, 3), count: q.count }));
  return {
    classes: classList, subjects: [...newSubjects.values()], teachers: teacherPlans, assignments, classTeachers,
    teacherSubjects: [...teacherSubjects].map((k) => { const [teacherRef, subjectRef] = k.split('|'); return { teacherRef, subjectRef }; }),
    students: studentPlans, questions: qList, skipped,
    summary: {
      teachersNew: teacherPlans.filter((t) => t.isNew).length, teachersExisting: teacherPlans.filter((t) => !t.isNew).length,
      assignments: assignments.length, classTeachers: classTeachers.length, pendingAssignments,
      newClasses: classList.map((c) => c.name), newSubjects: [...newSubjects.values()].map((s) => s.name),
      studentsNew: studentPlans.filter((s) => !s.existingId).length, studentsExisting: studentPlans.filter((s) => s.existingId).length,
      studentsMoved: studentPlans.filter((s) => s.moved).length, skippedCount: skipped.filter((m) => m !== '…and more').length, firstNameOnly,
    },
  };
}

const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// Writes a plan inside the caller's transaction. Returns the students it created, so parent accounts can be linked after commit.
export async function applySetup(client, { organizationId, centerId, plan, aliasAnswers = [] }) {
  const classId = {}, subjectId = {}, teacherId = {};
  for (const c of plan.classes) {
    const r = await client.query(
      `INSERT INTO classes (organization_id, center_id, name, grade, stream, section, grading_scheme) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [organizationId, centerId, c.name, c.grade, c.stream, c.section, c.scheme]);
    classId[c.ref] = r.rows[0].id;
  }
  for (const c of [...plan.assignments, ...plan.classTeachers]) if (c.classRef.startsWith('c:') && !c.classRef.startsWith('c:new:')) classId[c.classRef] = c.classRef.slice(2);
  for (const s of plan.students) if (s.classRef && s.classId) classId[s.classRef] = s.classId;

  for (const s of plan.subjects) {
    const r = await client.query(
      `INSERT INTO subjects (organization_id, center_id, name, code, section, is_science) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (center_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [organizationId, centerId, s.name, s.code, s.section, s.isScience]);
    subjectId[s.ref] = r.rows[0].id;
  }
  for (const a of plan.assignments) if (a.subjectRef.startsWith('s:') && !a.subjectRef.startsWith('s:new:')) subjectId[a.subjectRef] = a.subjectRef.slice(2);
  for (const t of plan.teacherSubjects) if (t.subjectRef.startsWith('s:') && !t.subjectRef.startsWith('s:new:')) subjectId[t.subjectRef] = t.subjectRef.slice(2);

  for (const t of plan.teachers) {
    if (t.id) {
      teacherId[t.ref] = t.id;
      await client.query(`UPDATE teachers SET phone = COALESCE(phone, $2), email = COALESCE(email, $3) WHERE id = $1 AND organization_id = $4`,
        [t.id, t.phone || null, t.email || null, organizationId]);
    } else {
      const r = await client.query(
        `INSERT INTO teachers (organization_id, center_id, full_name, phone, section, email) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [organizationId, centerId, t.name, t.phone || null, t.section, t.email || null]);
      teacherId[t.ref] = r.rows[0].id;
    }
  }
  for (const c of plan.classTeachers) await client.query(`INSERT INTO class_teachers (class_id, teacher_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [classId[c.classRef], teacherId[c.teacherRef]]);
  for (const t of plan.teacherSubjects) await client.query(`INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [teacherId[t.teacherRef], subjectId[t.subjectRef]]);
  for (const a of plan.assignments) await client.query(`INSERT INTO teacher_assignments (teacher_id, class_id, subject_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [teacherId[a.teacherRef], classId[a.classRef], subjectId[a.subjectRef]]);

  const created = [];
  const fresh = plan.students.filter((s) => !s.existingId), known = plan.students.filter((s) => s.existingId);
  for (const part of chunks(fresh, 1000)) {
    const r = await client.query(
      `INSERT INTO students (organization_id, center_id, school_id_number, full_name, class_id, kcpe_marks)
       SELECT $1::uuid, $2::uuid, t.a, t.n, t.c, t.k FROM unnest($3::text[], $4::text[], $5::uuid[], $6::int[]) AS t(a, n, c, k)
       RETURNING id, school_id_number`,
      [organizationId, centerId, part.map((s) => s.adm), part.map((s) => s.name), part.map((s) => (s.classRef ? classId[s.classRef] : null)), part.map((s) => s.kcpe)]);
    const byAdm = new Map(r.rows.map((x) => [x.school_id_number.toLowerCase(), x.id]));
    for (const s of part) created.push({ id: byAdm.get(s.adm.toLowerCase()), name: s.name, parentName: s.parentName, parentPhone: s.parentPhone });
  }
  for (const part of chunks(known, 1000)) {
    await client.query(
      `UPDATE students s SET class_id = COALESCE(t.c, s.class_id), kcpe_marks = COALESCE(t.k, s.kcpe_marks)
       FROM unnest($2::uuid[], $3::uuid[], $4::int[]) AS t(id, c, k) WHERE s.id = t.id AND s.organization_id = $1::uuid`,
      [organizationId, part.map((s) => s.existingId), part.map((s) => (s.classRef ? classId[s.classRef] : null)), part.map((s) => s.kcpe)]);
  }

  // answers to "which subject is this?" are remembered, so the same question is never asked again
  for (const a of aliasAnswers) {
    const sid = subjectId[`s:new:${lc(a.subject)}`] || a.subjectId;
    if (!sid) continue;
    await client.query(
      `INSERT INTO subject_aliases (organization_id, alias_key, alias_text, subject_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (organization_id, alias_key) DO UPDATE SET subject_id = EXCLUDED.subject_id, alias_text = EXCLUDED.alias_text`,
      [organizationId, normaliseKey(a.header), clean(a.header, 80), sid]);
  }
  return { created };
}

export { codeFor };
