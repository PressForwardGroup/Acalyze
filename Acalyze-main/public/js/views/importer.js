import { api } from '../api.js';
import { esc, $, $$, num, toast, run, table, pill } from '../ui.js';
import { parseWorkbook } from '../excel.js';

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

export const views = { excel };
