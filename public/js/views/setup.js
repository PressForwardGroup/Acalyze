import { api } from '../api.js';
import { esc, $, $$, toast, run, table, pill, modal, confirmBox, copy, fmtDate, num, stat, initials, band, bandColor, bandPill, bandTone, BAND_LABELS } from '../ui.js';
import { download } from './reportcard.js';

const SECTIONS = ['PRIMARY', 'JUNIOR', 'SENIOR'];
const opt = (rows, val = (r) => r.id, label = (r) => r.name, sel) => rows.map((r) => `<option value="${esc(val(r))}" ${val(r) === sel ? 'selected' : ''}>${esc(label(r))}</option>`).join('');
const campusField = (centers) => centers.length > 1 ? `<div><label class="f" for="center">Campus</label><select class="i" id="center">${opt(centers)}</select></div>` : '';
const val = (el, id) => ($('#' + id, el)?.value ?? '').trim();
const locked = (el, ctx, title, what) => { el.innerHTML = `${ctx.bar(title)}<div class="card empty">${what} isn't included in your school's current plan.<br><a class="btn gold" style="margin-top:14px" href="#/app/subscription">See your plan</a></div>`; };

// ---------- Classes ----------
async function classes(el, ctx) {
  const [cls, teachers, centers] = await Promise.all([api('/classes'), api('/teachers'), api('/centers')]);
  el.innerHTML = `${ctx.bar('Classes', 'A class is one stream, e.g. "Form 3 West" or "Grade 8 Blue"')}
  <div class="card"><h2 style="margin-bottom:12px">Add a class</h2><div class="form-grid">
    <div><label class="f" for="name">Class name *</label><input class="i" id="name" placeholder="Form 3 West"></div>
    <div><label class="f" for="grade">Grade / form *</label><input class="i" id="grade" placeholder="Form 3  or  Grade 8"></div>
    <div><label class="f" for="stream">Stream</label><input class="i" id="stream" placeholder="West"></div>
    <div><label class="f" for="section">Section</label><select class="i" id="section">${SECTIONS.map((s) => `<option>${s}</option>`).join('')}</select></div>${campusField(centers)}</div>
    <p class="sm mut">"Form N" classes use 8-4-4 grading; "Grade N" classes use CBC.</p><button class="btn primary" id="add">Add class</button></div>
  <div class="card pad0" style="margin-top:18px">${table(['Class', 'Grading', 'Students', 'Class teacher', ''], cls.map((c) => [`<b>${esc(c.name)}</b>`, pill(c.grading_scheme === 'cbc' ? 'CBC' : '8-4-4'), c.student_count, `<select class="i" data-ct="${c.id}" style="min-width:160px"><option value="">— none —</option>${opt(teachers, (t) => t.id, (t) => t.full_name, c.class_teacher_id)}</select>`, `<button class="btn sm danger" data-del="${c.id}">Delete</button>`]), { empty: 'No classes yet. Add your first one above.' })}</div>`;
  $('#add', el).onclick = (e) => run(e.currentTarget, async () => {
    if (!val(el, 'name') || !val(el, 'grade')) return toast('Class name and grade are required.', 'bad');
    await api('/classes', { method: 'POST', body: { name: val(el, 'name'), grade: val(el, 'grade'), stream: val(el, 'stream'), section: val(el, 'section'), centerId: val(el, 'center') || undefined } });
    toast('Class added', 'ok'); classes(el, ctx);
  });
  $$('[data-ct]', el).forEach((s) => (s.onchange = () => run(null, async () => { await api(`/classes/${s.dataset.ct}/class-teacher`, { method: 'PATCH', body: { teacherId: s.value || null } }); toast('Class teacher saved', 'ok'); })));
  $$('[data-del]', el).forEach((b) => (b.onclick = async () => { if (await confirmBox('Delete this class? Students in it become unassigned.', 'Delete')) run(b, async () => { await api(`/classes/${b.dataset.del}`, { method: 'DELETE' }); classes(el, ctx); }); }));
}

// ---------- Subjects ----------
async function subjects(el, ctx) {
  const [subs, centers] = await Promise.all([api('/subjects'), api('/centers')]);
  el.innerHTML = `${ctx.bar('Subjects', 'Include the report-form code (e.g. 121) so it prints on the card')}
  <div class="card"><div class="form-grid">
    <div><label class="f" for="name">Subject name *</label><input class="i" id="name" placeholder="Mathematics"></div>
    <div><label class="f" for="code">Code</label><input class="i" id="code" placeholder="121"></div>
    <div><label class="f" for="section">Section</label><select class="i" id="section"><option value="">All sections</option>${SECTIONS.map((s) => `<option>${s}</option>`).join('')}</select></div>${campusField(centers)}</div>
    <p class="sm mut">Maths, Biology, Physics and Chemistry are marked as sciences automatically (they use their own 8-4-4 grade boundaries).</p>
    <div class="row"><button class="btn primary" id="add">Add subject</button><button class="btn" id="defaults">Add the standard 8-4-4 subjects</button></div></div>
  <div class="card pad0" style="margin-top:18px">${table(['Subject', 'Code', 'Section', 'Type', ''], subs.map((s) => [`<b>${esc(s.name)}</b>`, esc(s.code || '—'), esc(s.section || 'All'), s.is_science ? pill('Science', 'ok') : '', `<button class="btn sm danger" data-del="${s.id}">Delete</button>`]), { empty: 'No subjects yet.' })}</div>`;
  const add = (b, body) => run(b, async () => { await api('/subjects', { method: 'POST', body }); });
  $('#add', el).onclick = (e) => run(e.currentTarget, async () => {
    if (!val(el, 'name')) return toast('Enter the subject name.', 'bad');
    await api('/subjects', { method: 'POST', body: { name: val(el, 'name'), code: val(el, 'code'), section: val(el, 'section') || null, centerId: val(el, 'center') || undefined } });
    toast('Subject added', 'ok'); subjects(el, ctx);
  });
  $('#defaults', el).onclick = (e) => run(e.currentTarget, async () => {
    const have = new Set(subs.map((s) => s.name.toLowerCase()));
    const std = [['English', '101'], ['Kiswahili', '102'], ['Mathematics', '121'], ['Biology', '231'], ['Physics', '232'], ['Chemistry', '233'], ['History & Government', '311'], ['Geography', '312'], ['CRE', '313'], ['Agriculture', '443'], ['Computer Studies', '451'], ['Business Studies', '565']];
    let n = 0; for (const [name, code] of std) { if (have.has(name.toLowerCase())) continue; await api('/subjects', { method: 'POST', body: { name, code, centerId: val(el, 'center') || undefined } }); n++; }
    toast(n ? `Added ${n} subjects` : 'Those subjects already exist', 'ok'); subjects(el, ctx);
  });
  $$('[data-del]', el).forEach((b) => (b.onclick = async () => { if (await confirmBox('Delete this subject? Marks entered for it are removed too.', 'Delete')) run(b, async () => { await api(`/subjects/${b.dataset.del}`, { method: 'DELETE' }); subjects(el, ctx); }); }));
}

// ---------- Teachers ----------
async function teachers(el, ctx) {
  const [list, cls, subs, centers] = await Promise.all([api('/teachers'), api('/classes'), api('/subjects'), api('/centers')]);
  const clsName = Object.fromEntries(cls.map((c) => [c.id, c.name])), subName = Object.fromEntries(subs.map((s) => [s.id, s.name]));
  el.innerHTML = `${ctx.bar('Teachers', 'Each teacher signs in with their own email')}
  <div class="card"><h2 style="margin-bottom:12px">Add a teacher</h2><div class="form-grid">
    <div><label class="f" for="fn">Full name *</label><input class="i" id="fn"></div>
    <div><label class="f" for="em">Email (their login) *</label><input class="i" id="em" type="email"></div>
    <div><label class="f" for="ph">Phone</label><input class="i" id="ph" type="tel"></div>
    <div><label class="f" for="sec">Section *</label><select class="i" id="sec">${SECTIONS.map((s) => `<option>${s}</option>`).join('')}</select></div>
    <div><label class="f" for="pw">Temporary password *</label><input class="i" id="pw" value="${Math.random().toString(36).slice(2, 10)}"></div>${campusField(centers)}</div>
    <p class="sm mut">They'll be asked to choose their own password the first time they sign in. Then assign their classes and subjects below.</p>
    <div class="row"><button class="btn primary" id="add">Add teacher</button><button class="btn" id="bulk">Import from CSV</button></div></div>
  <div class="card pad0" style="margin-top:18px">${table(['Teacher', 'Email', 'Section', 'Teaches', ''], list.map((t) => [`<b>${esc(t.full_name)}</b>`, esc(t.email || '—'), pill(t.section), `<span class="sm">${t.assignments.length ? t.assignments.slice(0, 3).map((a) => `${esc(clsName[a.class_id] || '?')}: ${esc(subName[a.subject_id] || '?')}`).join('<br>') + (t.assignments.length > 3 ? `<br><span class="mut">+${t.assignments.length - 3} more</span>` : '') : '<span class="mut">Nothing assigned</span>'}</span>`,
    `<div class="row" style="gap:6px"><button class="btn sm" data-assign="${t.id}">Classes & subjects</button><button class="btn sm" data-reset="${t.id}">Reset password</button><button class="btn sm danger" data-del="${t.id}">Delete</button></div>`]), { empty: 'No teachers yet.' })}</div>`;
  $('#add', el).onclick = (e) => run(e.currentTarget, async () => {
    if (!val(el, 'fn') || !val(el, 'em') || !val(el, 'pw')) return toast('Name, email and a temporary password are required.', 'bad');
    await api('/teachers', { method: 'POST', body: { fullName: val(el, 'fn'), email: val(el, 'em'), phone: val(el, 'ph'), section: val(el, 'sec'), password: val(el, 'pw'), centerId: val(el, 'center') || undefined } });
    modal(`<h3>Teacher added</h3><p>Give ${esc(val(el, 'fn'))} these sign-in details:</p><p>Email: <span class="secret">${esc(val(el, 'em'))}</span><br>Temporary password: <span class="secret">${esc(val(el, 'pw'))}</span></p><button class="btn primary" data-close>Done</button>`);
    teachers(el, ctx);
  });
  $('#bulk', el).onclick = () => csvModal({ title: 'Import teachers', hint: 'Columns: Full Name, Section (PRIMARY/JUNIOR/SENIOR), Class, Subject, Phone. Teachers imported this way need an email and password set afterwards.', path: '/teachers/bulk', example: 'Full Name,Section,Class,Subject,Phone\nJane Wanjiku,SENIOR,Form 3 West,Mathematics,0712345678', done: () => teachers(el, ctx) });
  $$('[data-reset]', el).forEach((b) => (b.onclick = () => { const pw = Math.random().toString(36).slice(2, 10); modal(`<h3>Reset password</h3><p>Set a temporary password. They'll choose a new one at next sign-in.</p><input class="i" id="np" value="${pw}"><div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Reset</button></div>`, { onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => { await api(`/teachers/${b.dataset.reset}/reset-password`, { method: 'POST', body: { password: $('#np', m).value } }); close(); toast('Password reset. Tell the teacher their temporary password.', 'ok'); }); } }); }));
  $$('[data-del]', el).forEach((b) => (b.onclick = async () => { if (await confirmBox('Delete this teacher?', 'Delete')) run(b, async () => { await api(`/teachers/${b.dataset.del}`, { method: 'DELETE' }); teachers(el, ctx); }); }));
  $$('[data-assign]', el).forEach((b) => (b.onclick = () => {
    const t = list.find((x) => x.id === b.dataset.assign), has = new Set(t.assignments.map((a) => `${a.class_id}|${a.subject_id}`));
    modal(`<h3>${esc(t.full_name)}: classes & subjects</h3><p class="sm mut">Tick every subject this teacher teaches in each class. They can only enter marks for ticked pairs.</p>
      <div style="max-height:50vh;overflow:auto">${cls.map((c) => `<div style="margin:12px 0"><div class="b">${esc(c.name)}</div><div class="row" style="gap:6px 16px">${subs.map((s) => `<label class="sm"><input type="checkbox" data-p="${c.id}|${s.id}" ${has.has(`${c.id}|${s.id}`) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}</div></div>`).join('') || '<div class="empty">Add classes and subjects first.</div>'}</div>
      <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="save">Save</button></div>`, { onMount: (m, close) => { $('#save', m).onclick = (e) => run(e.currentTarget, async () => { const assignments = $$('[data-p]:checked', m).map((i) => { const [classId, subjectId] = i.dataset.p.split('|'); return { classId, subjectId }; }); await api(`/teachers/${t.id}/assignments`, { method: 'PUT', body: { assignments } }); close(); toast('Saved', 'ok'); teachers(el, ctx); }); } });
  }));
}

function csvModal({ title, hint, path, example, extra = {}, done, showLogins }) {
  modal(`<h3>${esc(title)}</h3><p class="sm mut">${esc(hint)}</p><textarea class="i" id="csv" placeholder="${esc(example)}"></textarea>
    <div class="row" style="margin-top:10px"><input type="file" id="file" accept=".csv,text/csv" class="sm"></div><div id="res" style="margin-top:12px"></div>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-close>Close</button><button class="btn primary" id="go">Upload</button></div>`, {
    onMount: (m) => {
      $('#file', m).onchange = async (e) => { const f = e.target.files[0]; if (f) $('#csv', m).value = await f.text(); };
      $('#go', m).onclick = (e) => run(e.currentTarget, async () => {
        const csv = $('#csv', m).value; if (!csv.trim()) return toast('Paste your CSV or choose a file.', 'bad');
        const r = await api(path, { method: 'POST', body: { csv, ...extra } }); done?.();
        $('#res', m).innerHTML = `<div class="notice ok">${r.added} added.</div>${(r.scaleWarnings || []).map((w) => `<div class="notice" style="margin-top:8px">⚠ ${esc(w.message)}</div>`).join('')}${r.skipped?.length ? `<div class="notice" style="margin-top:8px"><b>${r.skipped.length} skipped:</b><br>${r.skipped.slice(0, 12).map(esc).join('<br>')}${r.skipped.length > 12 ? '<br>…' : ''}</div>` : ''}${showLogins && r.parentLogins?.length ? showLogins(r.parentLogins) : ''}`;
        const dl = $('#dlLogins', m); if (dl) dl.onclick = () => download('parent-logins.csv', 'Phone,Temporary password,Student\n' + r.parentLogins.map((l) => `${l.phone},${l.tempPassword},"${l.student}"`).join('\n'), 'text/csv');
      });
    } });
}

// ---------- Students ----------
async function students(el, ctx) {
  const [list, cls, ex, ov] = await Promise.all([api('/students'), api('/classes'), api('/exams'), api('/analytics/overview').catch(() => null)]);
  const cleared = new Set((await api('/fees/cleared').catch(() => ({ cleared: [] }))).cleared);   // only a tag: school admins never see amounts
  const rates = {};
  if (ctx.features.attendance !== false) ((await api('/attendance/rates').catch(() => null))?.rows || []).forEach((x) => (rates[x.student_id] = x));
  const clsName = Object.fromEntries(cls.map((c) => [c.id, c.name]));
  const KEY = 'acalyze.views.students';
  const saved = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  const keep = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage may be blocked */ } };
  let f = { q: '', cls: '', st: '', left: false, exam: ov?.latestExam?.id || ex[0]?.id || '' };
  const means = new Map(), loaded = new Set();
  async function loadMeans(examId) {
    if (!examId || loaded.has(examId)) return;
    const parts = await Promise.all(cls.map((c) => api(`/results?examId=${examId}&classId=${c.id}`).catch(() => null)));
    parts.forEach((d) => d?.rows.forEach((r) => {
      const top = d.scheme === 'cbc' ? 8 : 12, m = r.mean != null ? +r.mean : r.meanPoints != null ? (r.meanPoints / top) * 100 : null;
      means.set(`${examId}|${r.student.id}`, { mean: m, grade: r.grade, pos: r.position, of: r.outOf });
    }));
    loaded.add(examId);
  }
  const info = (s) => means.get(`${f.exam}|${s.id}`), lvl = (s) => band(info(s)?.mean);
  const rows = () => list.filter((s) => (f.left || s.status !== 'left') && (!f.cls || (f.cls === '-' ? !s.class_id : s.class_id === f.cls)) && (!f.q || `${s.full_name} ${s.school_id_number}`.toLowerCase().includes(f.q))
    && (!f.st || (f.st === 'none' ? !lvl(s) : String(lvl(s)) === f.st)));
  const attCell = (s) => { const a = rates[s.id]; return a?.rate != null ? `<div class="attb"><div class="bar"><i style="width:${a.rate}%;background:${bandColor(a.rate)}"></i></div><span class="sm b">${num(a.rate)}%</span></div>` : '<span class="mut">—</span>'; };
  const tr = (s) => { const i = info(s), m = i?.mean, b = band(m);
    return `<tr class="click" data-go="${s.id}"><td><input type="checkbox" data-s="${s.id}" aria-label="Select ${esc(s.full_name)}"></td>
      <td><div class="who"><span class="ava b${b || 0}">${esc(initials(s.full_name))}</span><div><b>${esc(s.full_name)}</b>${cleared.has(s.id) ? ' <span class="pill ok">Fees cleared</span>' : ''}<div class="mut sm">Adm ${esc(s.school_id_number)}</div></div></div></td>
      <td>${esc(clsName[s.class_id] || '—')}</td><td>${attCell(s)}</td><td>${m != null ? `<b>${num(m)}%</b>` : '<span class="mut">—</span>'}</td><td>${b ? bandPill(m) : '<span class="pill">No marks</span>'}</td><td class="mut">›</td></tr>`; };

  el.innerHTML = `${ctx.bar('Students', `${list.length} students`, '<button class="btn sm" id="exp">Export</button><button class="btn sm" id="saveView">Save this view</button><button class="btn sm primary" id="toggleAdd">+ Add student</button>')}
  <div class="card hide" id="addcard" style="margin-bottom:18px"><h2 style="margin-bottom:12px">Add a student</h2><div class="form-grid">
    <div><label class="f" for="fn">Full name *</label><input class="i" id="fn"></div>
    <div><label class="f" for="adm">Admission number *</label><input class="i" id="adm"></div>
    <div><label class="f" for="cl">Class</label><select class="i" id="cl"><option value="">— choose —</option>${opt(cls)}</select></div>
    <div><label class="f" for="pn">Parent name</label><input class="i" id="pn"></div>
    <div><label class="f" for="pp">Parent phone</label><input class="i" id="pp" type="tel" placeholder="07xx xxx xxx"></div>
    <div><label class="f" for="kc">KCPE marks (8-4-4)</label><input class="i" id="kc" type="number" min="0" max="500"></div></div>
    ${ctx.features.parents ? '<p class="sm mut">A parent account is created from the phone number, and you get a temporary password to hand over.</p>' : '<p class="sm mut">Your plan has no parent accounts, so parent phones are not used.</p>'}
    <div class="row"><button class="btn primary" id="add">Add student</button><button class="btn" id="bulk">Import from CSV</button></div></div>
  <div class="row filters"><input class="i" id="q" placeholder="Search name or admission no." style="max-width:250px" aria-label="Search students">
    <select class="i" id="cf" style="width:auto" aria-label="Class"><option value="">All classes</option><option value="-">No class</option>${opt(cls)}</select>
    <select class="i" id="stf" style="width:auto" aria-label="Status"><option value="">Any status</option><option value="5">Excellent</option><option value="4">Good</option><option value="3">Monitor</option><option value="2">At risk</option><option value="1">Critical</option><option value="none">No marks</option></select>
    <select class="i" id="exf" style="width:auto;max-width:230px" aria-label="Exam for marks and status">${ex.length ? opt(ex, (e) => e.id, (e) => e.name + (e.academic_year ? ' · ' + e.academic_year : ''), f.exam) : '<option value="">No exams yet</option>'}</select>
    <label class="sm mut" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="lf"> Include students who left</label>
    <span class="grow"></span><select class="i" id="mvto" style="width:auto" aria-label="Move selected"><option value="">Move selected to…</option>${opt(cls)}</select><button class="btn sm danger" id="delsel">Delete selected</button></div>
  <div class="row" id="chips" style="gap:8px;margin:12px 0"></div>
  <div class="card pad0" id="tbl"><div class="empty">Loading marks…</div></div>`;

  const chips = () => {
    const act = [f.q && ['q', `Search: ${f.q}`], f.cls && ['cls', f.cls === '-' ? 'No class' : clsName[f.cls]], f.st && ['st', f.st === 'none' ? 'No marks' : BAND_LABELS[f.st]]].filter(Boolean);
    $('#chips', el).innerHTML = `${act.map(([k, t]) => `<span class="chip">${esc(t)} <button data-x="${k}" aria-label="Remove filter">✕</button></span>`).join('')}${saved().map((v, n) => `<span class="chip view"><button data-v="${n}">★ ${esc(v.name)}</button><button data-dv="${n}" aria-label="Delete saved view">✕</button></span>`).join('')}`;
    $$('[data-x]', el).forEach((b) => (b.onclick = () => { f[b.dataset.x] = ''; sync(); draw(); }));
    $$('[data-v]', el).forEach((b) => (b.onclick = async () => { const v = saved()[+b.dataset.v]; f = { ...f, q: '', cls: v.cls, st: v.st, exam: v.exam || f.exam }; sync(); await loadMeans(f.exam); draw(); }));
    $$('[data-dv]', el).forEach((b) => (b.onclick = () => { const v = saved(); v.splice(+b.dataset.dv, 1); keep(v); chips(); }));
  };
  const sync = () => { $('#q', el).value = f.q; $('#cf', el).value = f.cls; $('#stf', el).value = f.st; $('#exf', el).value = f.exam; };
  const draw = () => {
    const r = rows();
    $('#tbl', el).innerHTML = r.length ? `<div class="ov"><table><thead><tr><th><input type="checkbox" id="all" aria-label="Select all"></th><th>Student</th><th>Class</th><th>Attendance (30 days)</th><th>Mean</th><th>Status</th><th></th></tr></thead><tbody>${r.slice(0, 300).map(tr).join('')}</tbody></table></div>${r.length > 300 ? `<p class="sm mut" style="padding:10px 16px">Showing the first 300 of ${r.length}. Use the filters to narrow the list.</p>` : ''}` : '<div class="empty">No students match.</div>';
    $('#all', el)?.addEventListener('change', (e) => $$('[data-s]', el).forEach((c) => (c.checked = e.target.checked)));
    $$('tr[data-go]', el).forEach((t) => (t.onclick = (e) => { if (!e.target.closest('input')) location.hash = `#/app/student/${t.dataset.go}`; }));
    chips();
  };
  draw(); await loadMeans(f.exam); draw();
  const picked = () => $$('[data-s]:checked', el).map((c) => c.dataset.s);
  $('#q', el).oninput = (e) => { f.q = e.target.value.toLowerCase(); draw(); };
  $('#cf', el).onchange = (e) => { f.cls = e.target.value; draw(); };
  $('#stf', el).onchange = (e) => { f.st = e.target.value; draw(); };
  $('#exf', el).onchange = async (e) => { f.exam = e.target.value; $('#tbl', el).innerHTML = '<div class="empty">Loading marks…</div>'; await loadMeans(f.exam); draw(); };
  $('#lf', el).onchange = (e) => { f.left = e.target.checked; draw(); };
  $('#toggleAdd', el).onclick = () => $('#addcard', el).classList.toggle('hide');
  $('#exp', el).onclick = () => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`, head = ['Name', 'Admission no', 'Class', 'Attendance %', 'Mean %', 'Status'];
    const body = rows().map((s) => { const m = info(s)?.mean, a = rates[s.id]?.rate; return [s.full_name, s.school_id_number, clsName[s.class_id] || '', a ?? '', m != null ? num(m) : '', lvl(s) ? BAND_LABELS[lvl(s)] : 'No marks'].map(q).join(','); });
    download('students.csv', [head.map(q).join(','), ...body].join('\n'), 'text/csv'); toast('Download started', 'ok');
  };
  $('#saveView', el).onclick = () => modal(`<h3>Save this view</h3><p class="sm mut">Keeps your class, status and exam choices so you can open them again in one click.</p><input class="i" id="vn" placeholder="e.g. Form 3 at risk"><div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="vs">Save</button></div>`, {
    onMount: (m, close) => { $('#vs', m).onclick = () => { const name = $('#vn', m).value.trim(); if (!name) return toast('Give the view a name.', 'bad'); keep([...saved(), { name, cls: f.cls, st: f.st, exam: f.exam }].slice(-8)); close(); chips(); toast('View saved', 'ok'); }; } });
  $('#add', el).onclick = (e) => run(e.currentTarget, async () => {
    if (!val(el, 'fn') || !val(el, 'adm')) return toast('Name and admission number are required.', 'bad');
    const r = await api('/students', { method: 'POST', body: { fullName: val(el, 'fn'), schoolIdNumber: val(el, 'adm'), classId: val(el, 'cl') || undefined, parentName: val(el, 'pn'), parentPhone: val(el, 'pp'), kcpeMarks: +val(el, 'kc') || undefined } });
    if (r.newParentLogin) modal(`<h3>Student added</h3><p>A parent account was created. Give the parent these details:</p><p>Phone: <span class="secret">${esc(r.newParentLogin.phone)}</span><br>Temporary password: <span class="secret">${esc(r.newParentLogin.tempPassword)}</span></p><p class="sm mut">This is shown once. The parent chooses their own password after signing in.</p><button class="btn primary" data-close>Done</button>`);
    else toast('Student added', 'ok'); students(el, ctx);
  });
  $('#bulk', el).onclick = () => csvModal({ title: 'Import students', hint: 'Columns: Full Name, Admission No, Class (exact class name), Parent Name, Parent Phone. Parent accounts are created from the phone numbers.', path: '/students/bulk', example: 'Full Name,Admission No,Class,Parent Name,Parent Phone\nAmina Otieno,RVS-001,Form 3 West,Mary Otieno,0712345678', done: () => students(el, ctx),
    showLogins: (l) => `<div class="notice" style="margin-top:8px"><b>${l.length} new parent accounts.</b> Temporary passwords are shown once: <button class="btn sm" id="dlLogins">Download list (CSV)</button></div>` });
  $('#mvto', el).onchange = (e) => { const to = e.target.value, ids = picked(); if (!to) return; if (!ids.length) { e.target.value = ''; return toast('Tick some students first.', 'bad'); } run(null, async () => { const r = await api('/student-transfer', { method: 'POST', body: { studentIds: ids, classId: to } }); toast(`Moved ${r.moved} student(s)`, 'ok'); students(el, ctx); }); };
  $('#delsel', el).onclick = async (e) => { const ids = picked(); if (!ids.length) return toast('Tick some students first.', 'bad'); if (await confirmBox(`Delete ${ids.length} student(s) and all their marks?`, 'Delete')) run(e.target, async () => { await api('/student-transfer/delete-students', { method: 'POST', body: { ids } }); students(el, ctx); }); };
}

// ---------- Exams ----------
async function exams(el, ctx) {
  const [list, centers] = await Promise.all([api('/exams'), api('/centers')]);
  el.innerHTML = `${ctx.bar('Exams', 'Publish an exam when results are ready for parents to see')}
  <div class="card"><div class="form-grid">
    <div><label class="f" for="nm">Exam name *</label><input class="i" id="nm" placeholder="Term 2 End Exam"></div>
    <div><label class="f" for="tm">Term</label><select class="i" id="tm"><option value="">—</option><option>Term 1</option><option>Term 2</option><option>Term 3</option></select></div>
    <div><label class="f" for="yr">Academic year</label><input class="i" id="yr" value="${new Date().getFullYear()}"></div>${campusField(centers)}</div>
    <button class="btn primary" id="add">Create exam</button></div>
  <div class="card pad0" style="margin-top:18px">${table(['Exam', 'Term', 'Year', 'Status', ''], list.map((x) => [`<b>${esc(x.name)}</b>`, esc(x.term || '—'), esc(x.academic_year || '—'), x.is_published ? pill('Published', 'ok') : pill('Draft', 'warn'),
    `<div class="row" style="gap:6px"><button class="btn sm" data-pub="${x.id}" data-to="${!x.is_published}">${x.is_published ? 'Unpublish' : 'Publish'}</button><button class="btn sm danger" data-del="${x.id}">Delete</button></div>`]), { empty: 'No exams yet.' })}</div>`;
  $('#add', el).onclick = (e) => run(e.currentTarget, async () => { if (!val(el, 'nm')) return toast('Enter the exam name.', 'bad'); await api('/exams', { method: 'POST', body: { name: val(el, 'nm'), term: val(el, 'tm'), academicYear: val(el, 'yr'), centerId: val(el, 'center') || undefined } }); toast('Exam created', 'ok'); exams(el, ctx); });
  $$('[data-pub]', el).forEach((b) => (b.onclick = () => run(b, async () => { await api(`/exams/${b.dataset.pub}/publish`, { method: 'PATCH', body: { isPublished: b.dataset.to === 'true' } }); toast(b.dataset.to === 'true' ? 'Published. Parents can now see these results.' : 'Unpublished', 'ok'); exams(el, ctx); })));
  $$('[data-del]', el).forEach((b) => (b.onclick = async () => { if (await confirmBox('Delete this exam and ALL its marks? This cannot be undone.', 'Delete')) run(b, async () => { await api(`/exams/${b.dataset.del}`, { method: 'DELETE' }); exams(el, ctx); }); }));
}

// ---------- Marks upload (whole school) ----------
async function marks(el, ctx) {
  const list = await api('/exams');
  el.innerHTML = `${ctx.bar('Marks upload', 'Upload a whole exam for the whole school from a spreadsheet saved as CSV')}
  <div class="card"><div class="form-grid"><div><label class="f" for="ex">Exam</label><select class="i" id="ex">${opt(list)}</select></div></div>
    <p class="sm mut">Columns: <b>Admission No, Subject, Score, Out of</b> (Out of is optional and defaults to 100). Score can be a number or a grade (e.g. EE1 or B+). If a paper looks like it was marked out of 30 or 50 but read as 100, we'll warn you.</p>
    <textarea class="i" id="csv" placeholder="Admission No,Subject,Score,Out of&#10;RVS-001,Mathematics,47,50&#10;RVS-001,English,71"></textarea>
    <div class="row" style="margin-top:10px"><input type="file" id="file" accept=".csv,text/csv" class="sm"><button class="btn primary" id="go">Upload marks</button></div><div id="res" style="margin-top:14px"></div></div>
  <p class="sm mut" style="margin-top:12px">Teachers can also enter marks one class at a time from their own sign-in.</p>`;
  if (!list.length) { $('#go', el).disabled = true; $('#res', el).innerHTML = '<div class="notice">Create an exam first.</div>'; }
  $('#file', el).onchange = async (e) => { const f = e.target.files[0]; if (f) $('#csv', el).value = await f.text(); };
  $('#go', el).onclick = (e) => run(e.currentTarget, async () => {
    const csv = $('#csv', el).value; if (!csv.trim()) return toast('Paste your CSV or choose a file.', 'bad');
    const r = await api('/marks/bulk', { method: 'POST', body: { examId: $('#ex', el).value, csv } });
    $('#res', el).innerHTML = `<div class="notice ok">${r.added} marks saved.</div>${r.scaleWarnings.map((w) => `<div class="notice" style="margin-top:8px">⚠ ${esc(w.message)}</div>`).join('')}${r.skipped.length ? `<div class="notice bad" style="margin-top:8px"><b>${r.skipped.length} rows skipped:</b><br>${r.skipped.slice(0, 15).map(esc).join('<br>')}${r.skipped.length > 15 ? '<br>…' : ''}</div>` : ''}`;
  });
}

// ---------- Parents ----------
async function parents(el, ctx) {
  if (!ctx.features.parents) return locked(el, ctx, 'Parents', 'Parent accounts');
  const [list, studs] = await Promise.all([api('/parents'), api('/students')]);
  el.innerHTML = `${ctx.bar('Parents', `${list.length} parent accounts. Parents sign in with their phone number.`)}
  <div class="card"><h2 style="margin-bottom:12px">Link a parent to a student</h2><div class="form-grid">
    <div><label class="f" for="st">Student</label><select class="i" id="st">${opt(studs, (s) => s.id, (s) => `${s.full_name} (${s.school_id_number})`)}</select></div>
    <div><label class="f" for="ph">Parent phone *</label><input class="i" id="ph" type="tel"></div>
    <div><label class="f" for="nm">Parent name</label><input class="i" id="nm"></div></div><button class="btn primary" id="link">Link parent</button></div>
  <div class="card pad0" style="margin-top:18px">${table(['Parent', 'Phone', 'Children', 'Signed in', ''], list.map((p) => [`<b>${esc(p.full_name || '—')}</b>`, esc(p.phone), p.children.map((c) => `${esc(c.name)} <span class="mut sm">${esc(c.class || '')}</span>`).join('<br>'), p.password_changed ? pill('Yes', 'ok') : pill('Not yet', 'warn'), `<div class="row" style="gap:6px"><button class="btn sm" data-reset="${p.id}">New password</button><button class="btn sm danger" data-del="${p.id}">Remove</button></div>`]), { empty: 'No parent accounts yet. They are created when you add or import students with a parent phone.' })}</div>`;
  $('#link', el).onclick = (e) => run(e.currentTarget, async () => {
    if (!val(el, 'ph')) return toast('Enter the parent phone.', 'bad');
    const r = await api('/parents/link', { method: 'POST', body: { studentId: val(el, 'st'), phone: val(el, 'ph'), name: val(el, 'nm') } });
    if (r.newParentLogin) modal(`<h3>Parent account created</h3><p>Phone: <span class="secret">${esc(r.newParentLogin.phone)}</span><br>Temporary password: <span class="secret">${esc(r.newParentLogin.tempPassword)}</span></p><p class="sm mut">Shown once.</p><button class="btn primary" data-close>Done</button>`); else toast('Linked to the existing parent account', 'ok');
    parents(el, ctx);
  });
  $$('[data-reset]', el).forEach((b) => (b.onclick = () => run(b, async () => { const r = await api(`/parents/${b.dataset.reset}/reset`, { method: 'POST' }); modal(`<h3>New temporary password</h3><p>Phone: <span class="secret">${esc(r.phone)}</span><br>Password: <span class="secret">${esc(r.tempPassword)}</span></p><button class="btn primary" data-close>Done</button>`); })));
  $$('[data-del]', el).forEach((b) => (b.onclick = async () => { if (await confirmBox('Remove this parent account?', 'Remove')) run(b, async () => { await api(`/parents/${b.dataset.del}`, { method: 'DELETE' }); parents(el, ctx); }); }));
}

// ---------- Approvals ----------
async function approvals(el, ctx) {
  const [pending, all] = await Promise.all([api('/edit-requests?status=pending'), api('/edit-requests')]);
  const hist = all.filter((r) => r.status !== 'PENDING').slice(0, 15);
  el.innerHTML = `${ctx.bar('Approvals', 'Changes teachers made to published results, and student name or admission changes')}
  <div class="card pad0">${table(['Change', 'From', 'To', 'Requested', ''], pending.map((r) => [`<b>${esc(r.label)}</b>`, esc(r.old_value || '—'), `<b>${esc(r.new_value || '(clear)')}</b>`, fmtDate(r.requested_at), `<div class="row" style="gap:6px"><button class="btn sm primary" data-ok="${r.id}">Approve</button><button class="btn sm" data-no="${r.id}">Reject</button></div>`]), { empty: 'Nothing waiting for you.' })}</div>
  ${hist.length ? `<h2 style="margin:24px 0 10px">Recently decided</h2><div class="card pad0">${table(['Change', 'From', 'To', 'Decision'], hist.map((r) => [esc(r.label), esc(r.old_value || '—'), esc(r.new_value || '(clear)'), r.status === 'APPROVED' ? pill('Approved', 'ok') : pill('Rejected', 'bad')]))}</div>` : ''}`;
  const act = (b, kind) => run(b, async () => { await api(`/edit-requests/${b.dataset[kind]}/${kind === 'ok' ? 'approve' : 'reject'}`, { method: 'POST' }); toast(kind === 'ok' ? 'Approved and applied' : 'Rejected', 'ok'); approvals(el, ctx); ctx.refreshBadges(); });
  $$('[data-ok]', el).forEach((b) => (b.onclick = () => act(b, 'ok'))); $$('[data-no]', el).forEach((b) => (b.onclick = () => act(b, 'no')));
}

// ---------- One student ----------
async function student(el, ctx) {
  const id = decodeURIComponent(location.hash.split('/')[3] || '');
  const back = '<a class="btn sm" href="#/app/students">← All students</a>';
  const [list, cls, trend, att, fees] = await Promise.all([api('/students'), api('/classes'), api(`/report-card/${encodeURIComponent(id)}/trend`).catch(() => []),
    ctx.features.attendance !== false ? api(`/attendance/rates?studentId=${encodeURIComponent(id)}`).catch(() => null) : null, api('/fees/cleared').catch(() => ({ cleared: [] }))]);
  const s = list.find((x) => x.id === id);
  if (!s) { el.innerHTML = `${ctx.bar('Student not found', '', back)}<div class="card empty">This student is not at your school, or was removed.</div>`; return; }
  const className = cls.find((c) => c.id === s.class_id)?.name || 'No class yet';
  const a = att?.rows?.[0] || null, exams = trend.map((t) => t.exam);
  let examId = exams.length ? exams[exams.length - 1].id : '', tab = 'academic';
  const parents = s.parents || [];
  const call = parents[0]?.phone ? `<a class="btn sm" href="tel:${esc(String(parents[0].phone).replace(/[^\d+]/g, ''))}">Call parent</a>` : '';

  async function draw() {
    const card = examId ? await api(`/report-card/${encodeURIComponent(id)}?examId=${encodeURIComponent(examId)}`).then((r) => r.card).catch(() => null) : null;
    const sm = card?.summary || {}, mean = sm.mean != null ? +sm.mean : null, subj = (card?.lines || []).filter((l) => l.taken !== false && l.percent != null);
    const rising = trend.length >= 3 && trend.slice(-3).every((t, i, a2) => t.mean != null && (i === 0 || t.mean < a2[i - 1].mean));
    el.innerHTML = `${ctx.bar(s.full_name, `${className} · Adm ${s.school_id_number}`, `${back}${call}`)}
    <div class="card prof"><span class="ava lg b${band(mean) || 0}">${esc(initials(s.full_name))}</span><div class="grow"><h2>${esc(s.full_name)}</h2><div class="mut sm">${esc(className)} · Adm ${esc(s.school_id_number)} · ${esc(s.status || 'active')}</div></div>
      ${band(mean) ? bandPill(mean) : '<span class="pill">No marks yet</span>'}${fees.cleared.includes(s.id) ? '<span class="pill ok">Fees cleared</span>' : ''}</div>
    <div class="tabs">${[['academic', 'Academic'], ['attendance', 'Attendance'], ['personal', 'Personal'], ['contact', 'Contact']].map(([k, l]) => `<button class="tab ${tab === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div><div id="pane"></div>`;
    $$('.tab', el).forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    const pane = $('#pane', el);
    if (tab === 'academic') {
      pane.innerHTML = !exams.length ? '<div class="card empty">No marks have been entered for this student yet.</div>' : `
        <div class="row" style="margin-bottom:14px"><label class="f" for="ex" style="margin:0">Exam</label><select class="i" id="ex" style="width:auto;min-width:220px">${opt(exams, (e) => e.id, (e) => e.name, examId)}</select></div>
        <div class="grid g4 fade">${stat('Class position', sm.classPosition != null ? `${sm.classPosition} / ${sm.classOutOf}` : '—', { tone: bandTone(mean), sub: band(mean) ? BAND_LABELS[band(mean)] : '' })}
          ${stat('Mean score', mean != null ? num(mean) + '%' : '—', { tone: bandTone(mean), sub: band(mean) ? BAND_LABELS[band(mean)] : '' })}
          ${stat('Overall grade', sm.grade || '—', { tone: bandTone(mean), sub: sm.remark || '' })}
          ${stat('Attendance', a?.rate != null ? num(a.rate) + '%' : '—', { tone: bandTone(a?.rate), sub: a?.rate != null ? `${BAND_LABELS[band(a.rate)]} · last 30 days` : 'No register yet' })}</div>
        <div class="grid g2" style="margin-top:16px"><div class="card"><h2 style="margin-bottom:8px">Subjects</h2>${subj.length ? subj.map((l) => `<div class="subj"><span>${esc(l.name)}</span><div class="bar"><i style="width:${Math.min(100, l.percent)}%;background:${bandColor(l.percent)}"></i></div><b>${num(l.percent)}%</b>${bandPill(l.percent)}</div>`).join('') : '<div class="empty">No subject marks for this exam.</div>'}</div>
          <div class="card"><h2 style="margin-bottom:8px">Progress over exams</h2><div class="trend">${trend.slice(-6).map((t) => `<div><div class="tb" style="height:${Math.max(6, Math.min(100, t.mean ?? 0)) * 1.4}px;background:${bandColor(t.mean)}"></div><div class="sm mut">${esc(t.exam.name)}</div><b>${t.mean != null ? num(t.mean) + '%' : '—'}</b></div>`).join('')}</div>
          ${rising ? '<div class="notice" style="margin-top:14px;background:var(--b2bg);color:var(--b2ink)">Falling for two exams in a row. Consider speaking to the parent.</div>' : ''}</div></div>`;
      $('#ex', pane)?.addEventListener('change', (e) => { examId = e.target.value; draw(); });
    } else if (tab === 'attendance') {
      pane.innerHTML = !a ? '<div class="card empty">No register has been taken for this student in the last 30 days.</div>' : `<div class="grid g4 fade">${stat('Attendance rate', num(a.rate) + '%', { tone: bandTone(a.rate), sub: `${BAND_LABELS[band(a.rate)]} · last 30 days` })}${stat('Present', a.present)}${stat('Late', a.late)}${stat('Absent', a.absent, { tone: a.absent >= 5 ? 'b1' : a.absent >= 3 ? 'b2' : '' })}</div>${a.excused ? `<p class="sm mut" style="margin-top:12px">${a.excused} excused day(s) also counted.</p>` : ''}`;
    } else if (tab === 'personal') {
      pane.innerHTML = `<div class="card">${[['Full name', s.full_name], ['Admission number', s.school_id_number], ['Class', className], ['Status', s.status || 'active'], ['KCPE marks', s.kcpe_marks ?? '—']].map(([k, v]) => `<div class="line"><span class="mut">${k}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
    } else {
      pane.innerHTML = `<div class="card">${parents.length ? parents.map((p) => `<div class="line"><span><b>${esc(p.name || 'Parent')}</b><div class="mut sm">${esc(p.phone)}</div></div><a class="btn sm" href="tel:${esc(String(p.phone).replace(/[^\d+]/g, ''))}">Call</a></div>`).join('') : '<div class="empty">No parent is linked to this student yet.</div>'}</div>`;
    }
  }
  await draw();
}

export const views = { classes, subjects, teachers, students, student, exams, marks, parents, approvals };
