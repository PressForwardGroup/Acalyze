import { api } from '../api.js';
import { esc, $, $$, num, toast, run, table, pill, bandPill, bandTone, bandColor, stat } from '../ui.js';
import { messages } from './chat.js';
import * as school from './school.js';
import { hello, dateLine, countTone, countSub, waitingBar, tiles, reports } from './home.js';

const opt = (rows, val, label, sel) => rows.map((r) => `<option value="${esc(val(r))}" ${val(r) === sel ? 'selected' : ''}>${esc(label(r))}</option>`).join('');
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

// ---------- Home ----------
async function overview(el, ctx) {
  const [teachers, classes, subjects, exams, classTeacherOf, unread] = await Promise.all([api('/teachers'), api('/classes'), api('/subjects'), api('/exams'),
    api('/student-transfer/class-results/mine').catch(() => []), ctx.features.chat !== false ? api('/chat/unread').catch(() => null) : null]);
  const mine = (teachers.find((t) => t.id === ctx.me.id)?.assignments) || [], latest = exams[0];
  const cName = Object.fromEntries(classes.map((c) => [c.id, c.name])), sName = Object.fromEntries(subjects.map((s) => [s.id, s.name]));
  // how much of each class and subject has marks for the latest exam
  const jobs = latest ? await Promise.all(mine.slice(0, 12).map(async (a) => {
    const rows = await api(`/marks?examId=${latest.id}&classId=${a.class_id}&subjectId=${a.subject_id}`).catch(() => []);
    const done = rows.filter((r) => r.percent != null || r.grade).length;
    return { cls: cName[a.class_id] || '?', sub: sName[a.subject_id] || '?', done, total: rows.length, pct: rows.length ? (done / rows.length) * 100 : 0 };
  })) : [];
  const open = jobs.filter((j) => j.total > 0 && j.done < j.total), left = unread?.unread || 0;
  const todo = [
    ...open.slice(0, 2).map((j) => ['✎', `Enter ${j.sub} marks`, `${j.cls} · ${j.done} of ${j.total} done`, 'marks']),
    left > 0 && ['✉', 'Read your messages', `${left} unread`, 'messages', left],
    ctx.features.attendance !== false && ['✓', 'Take the register', 'Mark who is in class today', 'attendance'],
    classTeacherOf.length > 0 && ['▤', 'My class results', classTeacherOf.map((c) => c.name).join(', '), 'myclass'],
  ].filter(Boolean).slice(0, 4);
  el.innerHTML = `${ctx.bar(hello(ctx.me, 'Teacher'), dateLine(ctx.me))}
  ${left > 0 ? waitingBar(`${left} unread message${left === 1 ? '' : 's'}`, '#/app/messages', 'Read now') : ''}
  ${!mine.length ? '<div class="card empty">You have not been assigned any classes and subjects yet.<br>Ask your school admin to assign them to you.</div>' : `
  <h2 class="sect">Needs attention</h2><div class="grid g3 fade">
    ${latest ? stat('Marks still to enter', open.length, { tone: countTone(open.length), sub: open.length ? `${latest.name}` : `All done for ${latest.name}` }) : stat('Marks still to enter', '—', { sub: 'No exam yet' })}
    ${ctx.features.chat !== false ? stat('Unread messages', left, { tone: countTone(left), sub: countSub(left) }) : ''}
    ${stat('My classes and subjects', mine.length, { sub: `${new Set(mine.map((a) => a.class_id)).size} class${new Set(mine.map((a) => a.class_id)).size === 1 ? '' : 'es'}` })}</div>
  ${tiles(todo)}
  ${jobs.length ? `<h2 class="sect">Marks entry for ${esc(latest.name)}</h2><div class="card fade">${jobs.map((j) => `<div style="margin:0 0 14px"><div class="row sm" style="justify-content:space-between;margin-bottom:5px"><span class="b">${esc(j.sub)} <span class="mut">· ${esc(j.cls)}</span></span><span class="mut">${j.done} of ${j.total} students</span></div><div class="bar" role="progressbar" aria-valuenow="${Math.round(j.pct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${j.pct}%;background:${bandColor(j.pct)}"></i></div></div>`).join('')}</div>` : ''}`}
  ${reports({ marks: 'Enter marks', attendance: 'Attendance', myclass: 'My class results' }, ['marks', 'attendance', ...(classTeacherOf.length ? ['myclass'] : [])])}`;
}

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
    $('#grid', el).innerHTML = table(['#', 'Student', 'Adm no.', `Score (out of ${outOf()})`, 'Grade'], rows.map((r, i) => [i + 1, `<b>${esc(r.full_name)}</b>`, esc(r.school_id_number), `<input class="i" style="width:110px;min-height:34px" data-st="${r.student_id}" value="${esc(shown(r))}" inputmode="decimal" aria-label="Score for ${esc(r.full_name)}">`, `<span data-g="${r.student_id}">${r.grade ? bandPill(r.percent, r.grade) : '<span class="mut">—</span>'}</span>`]), { empty: 'No students in this class.' });
    $$('[data-st]', el).forEach((inp) => {
      inp.onchange = () => run(null, async () => {
        const v = inp.value.trim(), id = inp.dataset.st, ex = $('#ex', el).value, row = rows.find((r) => r.student_id === id);
        const gcell = $(`[data-g="${id}"]`, el);
        if (v === '') { await api(`/marks?examId=${ex}&studentId=${id}&subjectId=${sub}`, { method: 'DELETE' }); row.percent = null; row.grade = null; gcell.innerHTML = '<span class="mut">—</span>'; return; }
        const numeric = /^\d+(\.\d+)?$/.test(v);
        const r = await api('/marks', { method: 'PUT', body: { examId: ex, studentId: id, subjectId: sub, ...(numeric ? { score: v, outOf: outOf() } : { grade: v }) } }).catch((e) => { inp.style.borderColor = 'var(--bad)'; throw e; });
        inp.style.borderColor = '';
        if (r.queued) { toast('This exam is published, so the change was sent to your admin for approval.', 'ok'); gcell.innerHTML = pill('Awaiting approval', 'warn'); return; }
        row.percent = r.mark.percent; row.grade = r.mark.grade; gcell.innerHTML = bandPill(r.mark.percent, r.mark.grade); inp.style.borderColor = 'var(--ok)'; setTimeout(() => (inp.style.borderColor = ''), 900);
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
    $('#res', el).innerHTML = `<div class="card pad0">${table(['Pos', 'Student', 'Subjects', 'Mean', 'Grade', 'Comment (saves when you click away)'], rows.map((x) => [x.position ?? '<span class="mut">W</span>', `<b>${esc(x.student.full_name)}</b>${cleared.has(x.student.id) ? ' <span class="pill ok">Fees cleared</span>' : ''}`, x.subjectsDone, x.mean != null ? num(x.mean) + '%' : '—', x.grade ? bandPill(x.mean, x.grade) : '—',
      `<input class="i" style="min-width:260px;min-height:34px" data-c="${x.student.id}" value="${esc(note[x.student.id] || '')}" maxlength="300" placeholder="e.g. Good progress, keep it up">`]), { empty: 'No students.' })}</div>`;
    $$('[data-c]', el).forEach((i) => (i.onchange = () => run(null, async () => { await api('/remarks', { method: 'PUT', body: { examId, studentId: i.dataset.c, text: i.value } }); i.style.borderColor = 'var(--ok)'; setTimeout(() => (i.style.borderColor = ''), 900); })));
  };
  $('#cl', el).onchange = $('#ex', el).onchange = () => load().catch((e) => toast(e.message, 'bad'));
  await load();
}

export const views = { overview, marks, attendance: school.views.attendance, myclass, messages, calendar: school.views.calendar };
