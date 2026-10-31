import { api } from '../api.js';
import { esc, $, $$, num, toast, run, table, pill } from '../ui.js';
import { parseWorkbook } from '../excel.js';
import { parseSetupWorkbook } from '../setupExcel.js';

let xlsxLib = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  xlsxLib ||= new Promise((res, rej) => {
    const s = Object.assign(document.createElement('script'), { src: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', onload: res, onerror: () => { xlsxLib = null; rej(new Error('Could not load the Excel reader. Check your internet connection and try again.')); } });
    document.head.append(s);
  });
  return xlsxLib;
}

async function excel(el, ctx) {
  const [exams, centers] = await Promise.all([api('/exams'), api('/centers')]);
  let parsed = [], checked = false;
  el.innerHTML = `${ctx.bar('Import from Excel', 'Bring in your school’s existing marks workbook: classes, students and marks in one go')}
  <div class="card"><h2>1. Choose your workbook</h2>
    <p class="sm mut" style="margin:6px 0 12px">Use the marks-entry workbook with one sheet per class (named like <b>FORM 3</b>, <b>FORM 4</b>, <b>GRADE 10</b>). Each sheet has student names, admission numbers, subject columns and a stream column. Nothing is saved until you press Import.</p>
    <input type="file" id="file" accept=".xlsx,.xls,.xlsm"><div id="status" class="sm mut" style="margin-top:8px"></div></div>
  <div id="work" class="hide"></div>`;

  $('#file', el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const st = $('#status', el); st.textContent = 'Reading…';
    try {
      await loadXlsx();
      const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const sheets = Object.fromEntries(wb.SheetNames.map((n) => [n, window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null })]));
      parsed = parseWorkbook(sheets); checked = false;
      if (!parsed.length) { st.textContent = 'No class sheets found in that file.'; $('#work', el).classList.add('hide'); return; }
      st.textContent = `${f.name}: ${parsed.filter((p) => !p.skipped).length} class sheet(s) found.`;
      draw();
    } catch (err) { st.textContent = ''; toast(err.message, 'bad'); }
  };

  const outOfInput = (i, k) => $(`[data-oo="${i}|${k}"]`, el);
  const build = () => parsed.map((p, i) => ({ p, i })).filter(({ p, i }) => !p.skipped && $(`[data-inc="${i}"]`, el)?.checked).map(({ p, i }) => ({
    name: p.name, level: p.level, subjects: p.subjects.map((s) => ({ key: s.key, code: s.code, name: s.name })),
    outOf: Object.fromEntries(p.subjects.map((s) => [s.key, +outOfInput(i, s.key)?.value || 100])),
    students: p.students.map((s) => ({ name: s.name, adm: s.adm, stream: s.stream, kcpe: s.kcpe, marks: s.marks })) }));
  const payload = (dryRun) => {
    const withMarks = $('input[name="mode"]:checked', el).value === 'marks', pick = $('#exam', el).value;
    return { dryRun, sheets: build(), importMarks: withMarks, centerId: $('#center', el)?.value || undefined,
      ...(withMarks ? (pick === 'new' ? { newExam: { name: $('#newname', el).value.trim(), academicYear: String(new Date().getFullYear()) } } : { examId: pick }) : {}) };
  };

  function draw() {
    const w = $('#work', el); w.classList.remove('hide');
    w.innerHTML = `<h2 style="margin:22px 0 10px">2. Check what we found</h2>
    ${parsed.map((p, i) => p.skipped ? `<div class="card flat" style="margin-bottom:12px;opacity:.75"><b>${esc(p.name)}</b> <span class="mut sm">skipped: ${esc(p.skipped)}</span></div>` : `
      <div class="card" style="margin-bottom:14px"><div class="row" style="justify-content:space-between;align-items:flex-start"><label class="row" style="gap:10px;cursor:pointer"><input type="checkbox" data-inc="${i}" checked><span><b style="font-size:16px">${esc(p.level.grade)}</b> <span class="mut sm">(sheet "${esc(p.name)}", ${p.level.scheme === 'cbc' ? 'CBC' : '8-4-4'})</span></span></label>
        <span class="sm"><b>${p.students.length}</b> students · <b>${p.subjects.length}</b> subjects</span></div>
        <div class="sm" style="margin:8px 0 4px"><span class="mut">Classes that will be used or created:</span> ${p.streams.map((s) => `<span class="pill">${esc(`${p.level.grade} ${s.stream === '(none)' ? '(no stream)' : s.stream}`)} · ${s.count}</span>`).join(' ')}</div>
        ${p.issues.length ? `<details style="margin:8px 0"><summary class="sm" style="cursor:pointer"><span class="pill warn">${p.issues.length} data note${p.issues.length > 1 ? 's' : ''}</span> click to read</summary><ul class="sm" style="margin:8px 0 0;padding-left:18px">${p.issues.slice(0, 15).map((x) => `<li>${esc(x)}</li>`).join('')}${p.issues.length > 15 ? `<li class="mut">…and ${p.issues.length - 15} more</li>` : ''}</ul></details>` : ''}
        <div class="ov" style="margin-top:8px">${table(['Subject', 'Marks found', 'Highest', 'Marked out of', 'Check'], p.subjects.map((s) => [`<b>${esc(s.name)}</b> <span class="mut sm">${esc(s.code)}</span>`, s.entries, s.entries ? num(s.max) : '—',
          `<input class="i" style="width:84px;min-height:32px" type="number" min="1" value="100" data-oo="${i}|${esc(s.key)}" aria-label="Out of for ${esc(s.name)}">`,
          s.suspicious ? `<span class="pill warn">Check</span> <span class="sm">${esc(s.reasons.join(', '))}. Marked out of ${s.suggestedOutOf}? <button class="btn sm" data-use="${i}|${esc(s.key)}|${s.suggestedOutOf}">Use ${s.suggestedOutOf}</button></span>` : s.entries ? '<span class="mut sm">Looks fine</span>' : '<span class="mut sm">No marks</span>']))}</div></div>`).join('')}
    <div class="card"><h2>3. Where should the marks go?</h2>
      <div style="margin:10px 0"><label class="row" style="gap:8px"><input type="radio" name="mode" value="marks" checked> Add the students <b>and</b> their marks</label>
      <label class="row" style="gap:8px;margin-top:6px"><input type="radio" name="mode" value="roster"> Add the students only (no marks yet)</label></div>
      <div class="form-grid" id="examBox"><div><label class="f" for="exam">Exam</label><select class="i" id="exam"><option value="new">Create a new exam…</option>${exams.map((x) => `<option value="${x.id}">${esc(x.name)}${x.academic_year ? ' · ' + esc(x.academic_year) : ''}</option>`).join('')}</select></div>
        <div id="nn"><label class="f" for="newname">New exam name</label><input class="i" id="newname" value="Imported exam"></div>
        ${centers.length > 1 ? `<div><label class="f" for="center">Campus</label><select class="i" id="center">${centers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>` : ''}</div>
      <p class="sm mut">Students already at your school (matched by admission number) are updated, not duplicated, and their marks for the chosen exam are replaced. Existing classes and subjects are reused.</p>
      <div class="row" style="margin-top:14px"><button class="btn" id="check">Check what will happen</button><button class="btn primary" id="go" disabled>Import now</button></div><div id="result" style="margin-top:16px"></div></div>`;
    const syncMode = () => { const m = $('input[name="mode"]:checked', w).value === 'marks'; $('#examBox', w).style.opacity = m ? 1 : 0.4; $('#exam', w).disabled = !m; $('#newname', w).disabled = !m; $('#nn', w).classList.toggle('hide', !m || $('#exam', w).value !== 'new'); };
    $$('input[name="mode"]', w).forEach((r) => (r.onchange = () => { syncMode(); reset(); })); $('#exam', w).onchange = () => { syncMode(); reset(); }; syncMode();
    $$('[data-use]', w).forEach((b) => (b.onclick = () => { const [i, k, v] = b.dataset.use.split('|'); outOfInput(i, k).value = v; reset(); toast(`Set to out of ${v}`, 'ok'); }));
    $$('[data-oo],[data-inc],#newname', w).forEach((x) => x.addEventListener('change', reset));
    $('#check', w).onclick = (e) => run(e.currentTarget, async () => {
      if (!build().length) return toast('Tick at least one sheet.', 'bad');
      const r = await api('/import/workbook', { method: 'POST', body: payload(true) }); show(r, true); checked = true; $('#go', w).disabled = false;
    });
    $('#go', w).onclick = (e) => run(e.currentTarget, async () => {
      if (!checked) return;
      const withMarks = $('input[name="mode"]:checked', w).value === 'marks';
      if (withMarks && $('#exam', w).value === 'new' && !$('#newname', w).value.trim()) return toast('Give the new exam a name.', 'bad');
      const r = await api('/import/workbook', { method: 'POST', body: payload(false) }); show(r, false); checked = false; $('#go', w).disabled = true; toast('Import complete', 'ok'); ctx.refreshBadges?.();
    });
  }
  function reset() { checked = false; const go = $('#go', el); if (go) go.disabled = true; }
  function show(r, dry) {
    const s = r.summary;
    $('#result', el).innerHTML = `<div class="notice ${dry ? '' : 'ok'}" style="${dry ? '' : ''}"><b>${dry ? 'This is what will happen (nothing saved yet):' : 'Done. Saved to your school:'}</b>
      <ul style="margin:8px 0 0;padding-left:18px"><li><b>${s.studentsNew}</b> new student(s)${s.studentsExisting ? `, <b>${s.studentsExisting}</b> already here and updated${s.studentsMoved ? ` (${s.studentsMoved} moved to a different class)` : ''}` : ''}</li>
      <li><b>${s.newClasses.length}</b> new class(es)${s.newClasses.length ? `: ${s.newClasses.map(esc).join(', ')}` : ''}</li><li><b>${s.newSubjects.length}</b> new subject(s)${s.newSubjects.length ? `: ${s.newSubjects.map(esc).join(', ')}` : ''}</li>
      ${s.marks != null ? `<li><b>${(s.marksSaved ?? s.marks).toLocaleString()}</b> mark(s)${dry ? ' ready to save' : ' saved'}</li>` : ''}</ul></div>
      ${r.skipped?.length ? `<details open style="margin-top:12px"><summary class="b sm" style="cursor:pointer">${s.skippedCount} row(s) will not be imported</summary><ul class="sm" style="padding-left:18px">${r.skipped.slice(0, 30).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
      ${dry ? '<p class="sm mut" style="margin-top:12px">Happy with this? Press <b>Import now</b>.</p>' : `<div class="row" style="margin-top:14px"><a class="btn primary" href="#/app/analytics">See results & analytics</a><a class="btn" href="#/app/students">View students</a><a class="btn" href="#/app/reportcards">Report cards</a></div>`}`;
  }
}

// ---------- teachers and students from one Excel workbook ----------
function templateWorkbook() {
  const X = window.XLSX, wb = X.utils.book_new();
  const add = (name, rows, widths) => { const ws = X.utils.aoa_to_sheet(rows); ws['!cols'] = widths.map((wch) => ({ wch })); X.utils.book_append_sheet(wb, ws, name); };
  add('TEACHERS', [['Name', 'Phone', 'Email', 'Section', 'Subject', 'Class', 'Class teacher'],
    ['Mary Wanjiku', '0712345678', 'mary@yourschool.ac.ke', 'PRIMARY', 'Mathematics, English', 'Grade 4 Red, Grade 4 Blue', 'Grade 4 Red'],
    ['John Otieno', '0722000111', '', 'JUNIOR', 'Integrated Science', 'Grade 7 Love', '']], [22, 14, 26, 10, 26, 28, 18]);
  add('STUDENTS', [['Admission No', 'Name', 'Class', 'Stream', 'Parent name', 'Parent phone'],
    ['A001', 'Amina Hassan', 'Grade 4', 'Red', 'Fatuma Hassan', '0711222333'],
    ['A002', 'Brian Mutua', 'Grade 4', 'Blue', '', '']], [14, 24, 12, 12, 22, 16]);
  X.writeFile(wb, 'Acalyze-setup-template.xlsx');
}

async function setupxl(el, ctx) {
  const centers = await api('/centers');
  let parsed = null, answers = {}, checked = false;
  el.innerHTML = `${ctx.bar('Set up from Excel', 'Teachers, their classes and subjects, and students, from one workbook')}
  <div class="card"><h2>1. Choose your workbook</h2>
    <p class="sm mut" style="margin:6px 0 12px">Any workbook with a <b>teachers</b> sheet and/or a <b>students</b> sheet. We recognise a teachers grid (stream rows, subject columns, like your TEACHERS sheet), a teachers list (name, phone, email, subject, class), a students list (admission no, name, class, parent phone) and class sheets such as FORM 3 or GRADE 10. Marks are not imported here.</p>
    <div class="row" style="gap:12px;flex-wrap:wrap;align-items:center"><input type="file" id="file" accept=".xlsx,.xls,.xlsm"><button class="btn" id="tpl">Download a blank template</button></div>
    <div id="status" class="sm mut" style="margin-top:8px"></div></div>
  <div id="work" class="hide"></div>`;

  $('#tpl', el).onclick = (e) => run(e.currentTarget, async () => { await loadXlsx(); templateWorkbook(); });
  $('#file', el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const st = $('#status', el); st.textContent = 'Reading…'; answers = {}; checked = false;
    try {
      await loadXlsx();
      const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const sheets = Object.fromEntries(wb.SheetNames.map((n) => [n, window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null })]));
      parsed = parseSetupWorkbook(sheets);
      if (!parsed.teachers.length && !parsed.students.length) { st.textContent = 'No teachers or students were found in that file. Try the blank template.'; $('#work', el).classList.add('hide'); return; }
      st.textContent = `${f.name}: ${parsed.teachers.length} teacher(s) and ${parsed.students.length} student(s) found.`;
      draw();
    } catch (err) { st.textContent = ''; toast(err.message, 'bad'); }
  };

  const payload = (dryRun) => ({ dryRun, teachers: parsed.teachers, students: parsed.students, answers, centerId: $('#center', el)?.value || undefined });
  const reset = () => { checked = false; const go = $('#go', el); if (go) go.disabled = true; };

  function draw() {
    const w = $('#work', el); w.classList.remove('hide');
    w.innerHTML = `<h2 style="margin:22px 0 10px">2. What we found</h2>
      <div class="card">${table(['Sheet', 'What it holds'], parsed.found.map((f) => [`<b>${esc(f.sheet)}</b>`, `${pill(f.kind === 'teachers' ? 'Teachers' : 'Students', 'ok')} ${esc(f.detail)}`]))}
      ${parsed.notes.length ? `<ul class="sm" style="margin:12px 0 0;padding-left:18px">${parsed.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</div>
      <div class="card" style="margin-top:14px"><h2>3. Check, then import</h2>
        ${centers.length > 1 ? `<div style="max-width:320px"><label class="f" for="center">Campus</label><select class="i" id="center">${centers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>` : ''}
        <p class="sm mut" style="margin:8px 0">Students already at your school (matched by admission number) are updated, not duplicated. Teachers are matched by name. Classes and subjects that are missing are created.</p>
        <div class="row" style="margin-top:10px"><button class="btn" id="check">Check what will happen</button><button class="btn primary" id="go" disabled>Import now</button></div>
        <div id="result" style="margin-top:16px"></div></div>`;
    $('#center', w)?.addEventListener('change', reset);
    $('#check', w).onclick = (e) => run(e.currentTarget, async () => { const r = await api('/import/setup', { method: 'POST', body: payload(true) }); show(r, true); checked = true; $('#go', w).disabled = false; });
    $('#go', w).onclick = (e) => run(e.currentTarget, async () => {
      if (!checked) return;
      const r = await api('/import/setup', { method: 'POST', body: payload(false) }); show(r, false); checked = false; $('#go', w).disabled = true; toast('Import complete', 'ok'); ctx.refreshBadges?.();
    });
  }

  function show(r, dry) {
    const s = r.summary, li = [];
    li.push(`<li><b>${s.teachersNew}</b> new teacher(s)${s.teachersExisting ? `, <b>${s.teachersExisting}</b> already here (missing phone or email filled in)` : ''}</li>`);
    li.push(`<li><b>${s.assignments}</b> class and subject assignment(s), <b>${s.classTeachers}</b> class teacher(s)</li>`);
    if (s.newClasses.length) li.push(`<li><b>${s.newClasses.length}</b> new class(es): ${s.newClasses.map(esc).join(', ')}</li>`);
    if (s.newSubjects.length) li.push(`<li><b>${s.newSubjects.length}</b> new subject(s): ${s.newSubjects.map(esc).join(', ')}</li>`);
    if (s.studentsNew || s.studentsExisting) li.push(`<li><b>${s.studentsNew}</b> new student(s)${s.studentsExisting ? `, <b>${s.studentsExisting}</b> already here and updated${s.studentsMoved ? ` (${s.studentsMoved} moved class)` : ''}` : ''}</li>`);
    const qs = r.questions || [];
    const q = qs.length ? `<div class="notice warn" style="margin-top:14px"><b>${qs.length} subject name${qs.length > 1 ? 's' : ''} we are not sure about.</b> Tell us once and we will remember it.
      <div class="ov" style="margin-top:10px">${table(['Written in the sheet', 'Where', 'Which subject is it?'], qs.map((x, i) => [`<b>${esc(x.header)}</b>`, `<span class="sm mut">${esc(x.classes.join(', '))}</span>`,
        `<select class="i" data-q="${i}" style="min-height:36px"><option value="">Choose…</option>${(x.suggestions || []).map((n) => `<option value="${esc(n)}">${esc(n)} (suggested)</option>`).join('')}<option value="__skip">Leave this subject out</option>${(r.choices || []).map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select>`]))}</div>
      <button class="btn sm" id="again" style="margin-top:10px">Check again with my answers</button></div>` : '';
    $('#result', el).innerHTML = `<div class="notice ${dry ? '' : 'ok'}"><b>${dry ? 'This is what will happen (nothing saved yet):' : 'Done. Saved to your school:'}</b><ul style="margin:8px 0 0;padding-left:18px">${li.join('')}</ul></div>${q}
      ${s.pendingAssignments ? `<p class="sm mut" style="margin-top:10px">${s.pendingAssignments} assignment(s) are waiting for the subject answers above and will be left out until they are given.</p>` : ''}
      ${s.firstNameOnly ? `<p class="sm mut" style="margin-top:6px">${s.firstNameOnly} teacher name(s) are a single name. Two people with the same name would be treated as one.</p>` : ''}
      ${r.skipped?.length ? `<details style="margin-top:12px"><summary class="b sm" style="cursor:pointer">${s.skippedCount} note(s) about rows that were not imported</summary><ul class="sm" style="padding-left:18px">${r.skipped.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></details>` : ''}
      ${dry ? '<p class="sm mut" style="margin-top:12px">Happy with this? Press <b>Import now</b>.</p>' : logins(r)}`;
    $$('[data-q]', el).forEach((sel) => (sel.onchange = () => {
      const h = qs[+sel.dataset.q].header;
      if (!sel.value) delete answers[h]; else answers[h] = sel.value === '__skip' ? { skip: true } : { subject: sel.value };
      reset();
    }));
    const again = $('#again', el);
    if (again) again.onclick = (e) => run(e.currentTarget, async () => { const r2 = await api('/import/setup', { method: 'POST', body: payload(true) }); show(r2, true); checked = true; $('#go', el).disabled = false; });
    const dl = $('#dlLogins', el);
    if (dl) dl.onclick = async () => { await loadXlsx(); const X = window.XLSX, wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Phone', 'Temporary password', 'Student'], ...r.parentLogins.map((l) => [l.phone, l.tempPassword, l.student])]), 'Parent logins'); X.writeFile(wb, 'parent-logins.xlsx'); };
  }
  function logins(r) {
    const more = r.parentsNotLinked ? `<p class="sm mut">${r.parentsNotLinked} more parent phone number(s) were not linked, because a very large import is kept quick. Add them from the Parents page.</p>` : '';
    if (!r.parentLogins?.length) return `${more}<div class="row" style="margin-top:14px"><a class="btn primary" href="#/app/teachers">See the teachers</a><a class="btn" href="#/app/students">See the students</a></div>`;
    return `<div class="notice warn" style="margin-top:14px"><b>${r.parentLogins.length} new parent login(s).</b> The temporary passwords are shown only now, so download them before leaving this page. <div style="margin-top:8px"><button class="btn sm" id="dlLogins">Download parent logins</button></div></div>${more}
      <div class="row" style="margin-top:14px"><a class="btn primary" href="#/app/teachers">See the teachers</a><a class="btn" href="#/app/students">See the students</a></div>`;
  }
}

export const views = { excel, setupxl };
