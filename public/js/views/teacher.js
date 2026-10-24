import { api } from '../api.js';
import { esc, $, $$, num, toast, run, table, pill } from '../ui.js';
import { messages } from './chat.js';
import * as school from './school.js';

const opt = (rows, val, label, sel) => rows.map((r) => `<option value="${esc(val(r))}" ${val(r) === sel ? 'selected' : ''}>${esc(label(r))}</option>`).join('');
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

// ---------- Enter marks ----------
async function marks(el, ctx) {
  const [teachers, classes, subjects, exams] = await Promise.all([api('/teachers'), api('/classes'), api('/subjects'), api('/exams')]);
  const mine = (teachers.find((t) => t.id === ctx.me.id)?.assignments) || [];
  if (!mine.length) { el.innerHTML = `${ctx.bar('Enter marks')}<div class="card empty">You haven't been assigned any classes and subjects yet.<br>Ask your school admin to assign them to you.</div>`; return; }
  if (!exams.length) { el.innerHTML = `${ctx.bar('Enter marks')}<div class="card empty">There are no exams yet. Your school admin creates them.</div>`; return; }
  const cName = Object.fromEntries(classes.map((c) => [c.id, c.name])), sName = Object.fromEntries(subjects.map((s) => [s.id, s.name]));
  const classIds = [...new Set(mine.map((a) => a.class_id))];
  let cls = classIds[0], sub = mine.find((a) => a.class_id === cls).subject_id, rows = [];

  el.innerHTML = `${ctx.bar('Enter marks', 'Type each score. It saves as you go.')}
  <div class="card"><div class="form-grid">
    <div><label class="f" for="ex">Exam</label><select class="i" id="ex">${opt(exams, (e) => e.id, (e) => `${e.name}${e.is_published ? ' (published)' : ''}`)}</select></div>
    <div><label class="f" for="cl">Class</label><select class="i" id="cl">${opt(classIds, (c) => c, (c) => cName[c] || '?', cls)}</select></div>
    <div><label class="f" for="sb">Subject</label><select class="i" id="sb"></select></div>
    <div><label class="f" for="of">Marked out of</label><input class="i" id="of" type="number" min="1" value="100"></div></div>
    <p class="sm mut" id="hint" style="margin:10px 0 0">Enter scores as numbers. If the paper was out of 30, set "Marked out of" to 30. For CBC you can also type a level such as EE1.</p></div>
  <div id="warn"></div><div class="card pad0" style="margin-top:16px" id="grid"></div>`;

  const subOpts = () => { const ids = mine.filter((a) => a.class_id === cls).map((a) => a.subject_id); $('#sb', el).innerHTML = opt(ids, (s) => s, (s) => sName[s] || '?', sub); if (!ids.includes(sub)) sub = ids[0]; $('#sb', el).value = sub; };
  const outOf = () => Math.max(1, +$('#of', el).value || 100);
  const shown = (r) => (r.percent == null ? (r.grade || '') : String(Math.round((+r.percent * outOf()) / 100 * 10) / 10));
  const checkScale = () => {
    const v = $$('[data-st]', el).map((i) => parseFloat(i.value)).filter((n) => !Number.isNaN(n));
    const o = outOf(); $('#warn', el).innerHTML = v.length >= 5 && o === 100 && median(v) < 15 ? `<div class="notice" style="margin-top:14px">⚠ Most scores are very low (median ${num(median(v))}). If this paper wasn't marked out of 100, change "Marked out of" above.</div>` : '';
  };
  const draw = () => {
    $('#grid', el).innerHTML = table(['#', 'Student', 'Adm no.', `Score (out of ${outOf()})`, 'Grade'], rows.map((r, i) => [i + 1, `<b>${esc(r.full_name)}</b>`, esc(r.school_id_number), `<input class="i" style="width:110px;min-height:34px" data-st="${r.student_id}" value="${esc(shown(r))}" inputmode="decimal" aria-label="Score for ${esc(r.full_name)}">`, `<span data-g="${r.student_id}">${r.grade ? pill(r.grade) : '<span class="mut">—</span>'}</span>`]), { empty: 'No students in this class.' });
    $$('[data-st]', el).forEach((inp) => {
      inp.onchange = () => run(null, async () => {
        const v = inp.value.trim(), id = inp.dataset.st, ex = $('#ex', el).value, row = rows.find((r) => r.student_id === id);
        const gcell = $(`[data-g="${id}"]`, el);
        if (v === '') { await api(`/marks?examId=${ex}&studentId=${id}&subjectId=${sub}`, { method: 'DELETE' }); row.percent = null; row.grade = null; gcell.innerHTML = '<span class="mut">—</span>'; return; }
        const numeric = /^\d+(\.\d+)?$/.test(v);
        const r = await api('/marks', { method: 'PUT', body: { examId: ex, studentId: id, subjectId: sub, ...(numeric ? { score: v, outOf: outOf() } : { grade: v }) } }).catch((e) => { inp.style.borderColor = 'var(--bad)'; throw e; });
        inp.style.borderColor = '';
        if (r.queued) { toast('This exam is published, so the change was sent to your admin for approval.', 'ok'); gcell.innerHTML = pill('Awaiting approval', 'warn'); return; }
        row.percent = r.mark.percent; row.grade = r.mark.grade; gcell.innerHTML = pill(r.mark.grade); inp.style.borderColor = 'var(--ok)'; setTimeout(() => (inp.style.borderColor = ''), 900);
      }).then(checkScale);
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const all = $$('[data-st]', el), i = all.indexOf(inp); all[i + 1]?.focus(); all[i + 1]?.select(); } };
    });
    checkScale();
  };
  const load = async () => { $('#grid', el).innerHTML = '<div class="empty">Loading…</div>'; rows = await api(`/marks?examId=${$('#ex', el).value}&classId=${cls}&subjectId=${sub}`); draw(); };
  $('#cl', el).onchange = (e) => { cls = e.target.value; sub = mine.find((a) => a.class_id === cls).subject_id; subOpts(); load().catch((x) => toast(x.message, 'bad')); };
  $('#sb', el).onchange = (e) => { sub = e.target.value; load().catch((x) => toast(x.message, 'bad')); };
  $('#ex', el).onchange = () => load().catch((x) => toast(x.message, 'bad'));
  $('#of', el).onchange = draw;
  subOpts(); await load();
}

// ---------- My class (class teacher): results + comments ----------
async function myclass(el, ctx) {
  const [classes, exams] = await Promise.all([api('/student-transfer/class-results/mine'), api('/exams')]);
  if (!classes.length) { el.innerHTML = `${ctx.bar('My class results')}<div class="card empty">You are not a class teacher yet. Your admin can assign you to a class.</div>`; return; }
  if (!exams.length) { el.innerHTML = `${ctx.bar('My class results')}<div class="card empty">No exams yet.</div>`; return; }
  el.innerHTML = `${ctx.bar('My class results', 'Results for the class you are class teacher of, and a comment for each student')}
  <div class="card"><div class="form-grid"><div><label class="f" for="cl">Class</label><select class="i" id="cl">${opt(classes, (c) => c.id, (c) => c.name)}</select></div>
    <div><label class="f" for="ex">Exam</label><select class="i" id="ex">${opt(exams, (e) => e.id, (e) => e.name)}</select></div></div></div><div id="res" style="margin-top:16px"></div>`;
  const load = async () => {
    const classId = $('#cl', el).value, examId = $('#ex', el).value; $('#res', el).innerHTML = '<div class="empty">Loading…</div>';
    const [r, rem, fees] = await Promise.all([api(`/student-transfer/class-results?examId=${examId}&classId=${classId}`), api(`/remarks?examId=${examId}&classId=${classId}`), api('/fees/cleared').catch(() => ({ cleared: [] }))]);
    const cleared = new Set(fees.cleared);   // only a tag: teachers never see amounts
    const note = Object.fromEntries(rem.map((x) => [x.student_id, x.text]));
    const rows = [...r.results].sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9));
    $('#res', el).innerHTML = `<div class="card pad0">${table(['Pos', 'Student', 'Subjects', 'Mean', 'Grade', 'Comment (saves when you click away)'], rows.map((x) => [x.position ?? '<span class="mut">W</span>', `<b>${esc(x.student.full_name)}</b>${cleared.has(x.student.id) ? ' <span class="pill ok">Fees cleared</span>' : ''}`, x.subjectsDone, x.mean != null ? num(x.mean) + '%' : '—', x.grade ? pill(x.grade) : '—',
      `<input class="i" style="min-width:260px;min-height:34px" data-c="${x.student.id}" value="${esc(note[x.student.id] || '')}" maxlength="300" placeholder="e.g. Good progress, keep it up">`]), { empty: 'No students.' })}</div>`;
    $$('[data-c]', el).forEach((i) => (i.onchange = () => run(null, async () => { await api('/remarks', { method: 'PUT', body: { examId, studentId: i.dataset.c, text: i.value } }); i.style.borderColor = 'var(--ok)'; setTimeout(() => (i.style.borderColor = ''), 900); })));
  };
  $('#cl', el).onchange = $('#ex', el).onchange = () => load().catch((e) => toast(e.message, 'bad'));
  await load();
}

export const views = { marks, attendance: school.views.attendance, myclass, messages, calendar: school.views.calendar };
