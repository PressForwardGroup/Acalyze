import { query } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';
import { gradeFor } from '../lib/grading.js';
import { linkParent } from '../lib/parents.js';

// A small, realistic demo school so every screen has something to show:
// one 8-4-4 grade with two streams, one exam with marks, a teacher, parents.
// Sign in as admin@demo.acalyze.app / Demo@2026 . Safe to run once; skips if it exists.
export async function seedDemoSchool() {
  if ((await query(`SELECT 1 FROM organizations WHERE slug = 'demo'`)).rows[0]) return;
  const org = (await query(
    `INSERT INTO organizations (name, slug, org_code, status, default_grading_scheme, motto, plan_name, rate_per_student, billing_cycle)
     VALUES ('Demo Academy','demo','DEM','active','844','Excellence in Learning','Full Suite',300,'annual') RETURNING id`)).rows[0].id;
  const center = (await query(`INSERT INTO centers (organization_id, name, center_code) VALUES ($1,'Main Campus','MAIN') RETURNING id`, [org])).rows[0].id;
  await query(`INSERT INTO admins (organization_id, full_name, email, password_hash) VALUES ($1,'Demo Admin','admin@demo.acalyze.app',$2)`, [org, await hashPassword('Demo@2026')]);
  const teacher = (await query(
    `INSERT INTO teachers (organization_id, center_id, full_name, section, email, password_hash, must_change_password)
     VALUES ($1,$2,'Mr. Kamau','SENIOR','kamau@demo.acalyze.app',$3,false) RETURNING id`, [org, center, await hashPassword('Demo@2026')])).rows[0].id;

  const subjDefs = [['Mathematics','121',true],['English','101',false],['Kiswahili','102',false],['Biology','231',true],
                    ['Physics','232',true],['Chemistry','233',true],['Geography','312',false],['CRE','313',false]];
  const subjects = [];
  for (const [name, code, sci] of subjDefs) {
    subjects.push((await query(`INSERT INTO subjects (organization_id, center_id, name, code, section, is_science) VALUES ($1,$2,$3,$4,'SENIOR',$5) RETURNING id, is_science`, [org, center, name, code, sci])).rows[0]);
  }
  const classes = [];
  for (const stream of ['West', 'East']) {
    classes.push((await query(
      `INSERT INTO classes (organization_id, center_id, name, grade, stream, section, grading_scheme, class_teacher_id)
       VALUES ($1,$2,$3,'Form 3',$4,'SENIOR','844',$5) RETURNING id`, [org, center, `Form 3 ${stream}`, stream, teacher])).rows[0].id);
  }
  const exam = (await query(`INSERT INTO exams (organization_id, center_id, name, term, academic_year, is_published) VALUES ($1,$2,'Term 2 End Exam','Term 2','2026',true) RETURNING id`, [org, center])).rows[0].id;

  const names = ['Amina Otieno','Brian Kiprop','Carol Wanjiru','Daniel Mwangi','Esther Achieng','Faith Njeri','George Omondi','Hellen Chebet',
                 'Isaac Mutua','Joy Wambui','Kevin Maina','Linet Akinyi','Moses Kariuki','Nancy Atieno','Oscar Kimani','Purity Moraa'];
  let seedN = 7; const rnd = () => (seedN = (seedN * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < names.length; i++) {
    const adm = `DEM-${String(i + 1).padStart(3, '0')}`;
    const cls = classes[i % 2];
    const st = (await query(`INSERT INTO students (organization_id, center_id, school_id_number, full_name, class_id, kcpe_marks) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [org, center, adm, names[i], cls, 330 + Math.floor(rnd() * 120)])).rows[0].id;
    const ability = 45 + rnd() * 40;
    for (const sub of subjects) {
      if (i === 5 && sub.id === subjects[4].id) continue; // one student short of subjects, to show the "W" case
      const pct = Math.max(8, Math.min(98, Math.round(ability + (rnd() - 0.5) * 30)));
      const g = gradeFor('844', pct, { isScience: sub.is_science, formLevel: 3 });
      await query(`INSERT INTO marks (exam_id, student_id, subject_id, grade, points, percent, entered_by_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [exam, st, sub.id, g.grade, g.points, pct, teacher]);
    }
    if (i < 8) await linkParent({ organizationId: org, studentId: st, parentName: `Parent of ${names[i].split(' ')[0]}`, parentPhone: `07120000${String(10 + i)}` });
  }
  await query(`UPDATE parents SET password_hash = $1, password_changed = true WHERE organization_id = $2`, [await hashPassword('Demo@2026'), org]);
  await query(`INSERT INTO teacher_assignments (teacher_id, class_id, subject_id) SELECT $1, c, s FROM unnest($2::uuid[]) c, unnest($3::uuid[]) s`,
    [teacher, classes, subjects.map((s) => s.id)]);
  console.log('[seed] Demo school ready: admin@demo.acalyze.app / Demo@2026 (parents: 0712000010.. / Demo@2026)');
}
