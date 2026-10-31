import { api } from '../api.js';
import { esc, $, $$, num, toast, run, table, stat, pill, progress, barChart, hbarChart, donut, color, fmtDate, band, bandColor, bandPill, bandTone, BAND_LABELS, recent, bandLegend, gradeBand, bandVar } from '../ui.js';
import { renderCard, cardOptions, saveCardOptions, termFromExam, printHtml, downloadPrintable, downloadPdf, PDF_LIMIT } from './reportcard.js';
import * as setup from './setup.js';
import * as account from './account.js';
import * as importer from './importer.js';
import * as school from './school.js';
import * as promotion from './promotion.js';
import { staff } from './staff.js';
import { audit } from './audit.js';

const examLabel = (e) => `${e.name}${e.academic_year ? ' · ' + e.academic_year : ''}${e.is_published ? '' : ' (draft)'}`;
const examSelect = (exams, sel, id = 'exam') => `<select class="i" id="${id}" style="min-width:230px;width:auto" aria-label="Exam">${exams.map((e) => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${esc(examLabel(e))}</option>`).join('')}</select>`;

// ---------- Overview ----------
async function overview(el, ctx) {
  const ov = await api('/analytics/overview');
  const c = ov.counts, steps = [
    ['Add your classes', c.classes > 0, 'classes'], ['Add subjects', c.subjects > 0, 'subjects'], ['Add teachers', c.teachers > 0, 'teachers'],
    ['Add students', c.students > 0, 'students'], ['Create an exam', ov.exams.length > 0, 'exams'], ['Enter or upload marks', ov.entryProgress.some((p) => p.with_marks > 0), 'marks']];
  const done = steps.filter((s) => s[1]).length;
  const prog = ov.entryProgress.filter((p) => p.students > 0);
  const edits = ov.pending.edits, resets = ov.pending.passwords, waiting = edits + resets;
  const total = prog.reduce((a, p) => a + p.students, 0), withMarks = prog.reduce((a, p) => a + p.with_marks, 0);
  const markPct = ov.latestExam && total ? (withMarks / total) * 100 : null;
  const behind = prog.filter((p) => p.with_marks < p.students).length;
  const latest = ov.exams.find((e) => e.id === ov.latestExam?.id);
  // a count of things waiting: none is excellent, a few is "monitor", many is "at risk"
  const countTone = (n) => (n === 0 ? 'b5' : n <= 4 ? 'b3' : 'b2'), countSub = (n) => (n === 0 ? 'All clear' : n <= 4 ? 'Needs monitoring' : 'At risk');
  const first = (ctx.me.name || '').split(' ')[0] || 'there', hr = new Date().getHours();
  const today = new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' });
  const todo = [
    markPct != null && markPct < 100 && ['pen', 'Enter or upload marks', `${total - withMarks} students have no marks yet`, 'marks'],
    latest && latest.is_published === false && ['doc', 'Publish results', `${latest.name} is still a draft`, 'exams'],
    edits > 0 && ['ok', 'Approve requests', 'Mark changes are waiting for you', 'approvals', edits],
    resets > 0 && ['lock', 'Reset passwords', 'People who cannot sign in', 'resets', resets],
    ctx.features.attendance !== false && ['ok', 'Take the register', 'Mark who is in class today', 'attendance'],
    ov.latestExam && ['doc', 'Print report cards', ov.latestExam.name, 'reportcards'],
  ].filter(Boolean).slice(0, 4);
  const NAMES = { analytics: 'Results & analytics', watch: 'Students to watch', reportcards: 'Report cards', fees: 'Fees', attendance: 'Attendance', students: 'Students' };
  const lists = recent.list().filter((k) => NAMES[k] && (k !== 'fees' || !ctx.me.financeSeparated));
  const reports = (lists.length ? lists : ['analytics', 'watch', 'reportcards']).slice(0, 5);
  el.innerHTML = `${ctx.bar(`Good ${hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening'}, ${first}`, `${ctx.me.organization || 'Your school'} · ${today}`)}
  ${waiting > 0 ? `<div class="note-bar fade"><b>${waiting} ${waiting === 1 ? 'thing is' : 'things are'} waiting</b><span class="grow mut">${edits} mark ${edits === 1 ? 'change' : 'changes'} to approve · ${resets} password ${resets === 1 ? 'reset' : 'resets'}</span><a class="btn sm primary" href="#/app/${edits ? 'approvals' : 'resets'}">Review now</a></div>` : ''}
  ${c.students > 0 ? `<h2 class="sect">Needs attention</h2><div class="grid g3 fade">
    ${markPct != null ? stat('Marks entered', Math.round(markPct) + '%', { tone: bandTone(markPct), sub: `${BAND_LABELS[band(markPct)]} · ${ov.latestExam.name}` }) : ''}
    ${stat('Classes still entering marks', ov.latestExam ? `${behind} of ${prog.length}` : '—', { tone: ov.latestExam ? countTone(behind) : '', sub: ov.latestExam ? countSub(behind) : 'No exam yet' })}
    ${stat('Approvals and resets', waiting, { tone: countTone(waiting), sub: countSub(waiting) })}</div>` : ''}
  ${todo.length ? `<h2 class="sect">Do today</h2><div class="tiles fade">${todo.map(([ic, t, sub, k, n]) => `<a class="tile" href="#/app/${k}"><span class="ti">${ic === 'pen' ? '✎' : ic === 'doc' ? '▤' : ic === 'lock' ? '🔑' : '✓'}</span><span class="grow"><b>${esc(t)}</b><span class="sm mut">${esc(sub)}</span></span>${n ? `<span class="badge">${n}</span>` : ''}<span class="mut">›</span></a>`).join('')}</div>` : ''}
  <h2 class="sect">School at a glance</h2><div class="grid g3 fade">${stat('Students', c.students)}${stat('Teachers', c.teachers)}${stat('Classes', c.classes)}</div>
  ${done < steps.length ? `<div class="card" style="margin-top:18px"><div class="row" style="justify-content:space-between"><h2>Getting started</h2><span class="mut sm">${done} of ${steps.length} done</span></div><div style="margin:10px 0 14px">${progress((done / steps.length) * 100)}</div>
     <div class="grid g3">${steps.map(([l, ok, k]) => `<a class="btn" style="justify-content:space-between;text-decoration:none" href="#/app/${k}"><span>${ok ? '✓ ' : ''}${esc(l)}</span><span class="mut">›</span></a>`).join('')}</div>
     ${c.students === 0 ? '<div class="notice ok" style="margin-top:14px"><b>Already have your marks in an Excel workbook?</b> <a href="#/app/excel">Import it</a> and your classes, subjects, students and marks are set up in one go.</div>' : ''}</div>` : ''}
  ${ov.latestExam && prog.length ? `<div class="card" style="margin-top:18px"><div class="row" style="justify-content:space-between"><h2>Marks entry by class</h2><span class="mut sm">${esc(ov.latestExam.name)}</span></div>
     <div class="grid g2" style="margin-top:14px">${prog.map((p) => { const pct = p.students ? (p.with_marks / p.students) * 100 : 0; return `<div><div class="row sm" style="justify-content:space-between;margin-bottom:5px"><span class="b">${esc(p.name)}</span><span class="mut">${p.with_marks} of ${p.students} students</span></div><div class="bar" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%;background:${bandColor(pct)}"></i></div></div>`; }).join('')}</div></div>` : ''}
  <h2 class="sect">Your reports</h2><div class="card pad0 fade">${reports.map((k) => `<a class="rep" href="#/app/${k}"><span><span class="star">★</span> ${esc(NAMES[k])}</span><span class="mut">›</span></a>`).join('')}</div>`;
}

// ---------- Results & analytics ----------
async function analytics(el, ctx) {
  const ov = await api('/analytics/overview');
  if (!ov.exams.length) { el.innerHTML = `${ctx.bar('Results & analytics')}<div class="card empty">Create an exam and enter some marks, and your analytics will appear here.<br><a class="btn primary" style="margin-top:14px" href="#/app/exams">Create an exam</a></div>`; return; }
  let examId = ov.exams[0].id, gi = 0;
  el.innerHTML = `${ctx.bar('Results & analytics', 'Computed live from entered marks', `<span id="sel"></span>`)}<div id="body"><div class="empty">Loading…</div></div>`;
  $('#sel', el).innerHTML = examSelect(ov.exams, examId);
  const load = async () => {
    const body = $('#body', el); body.innerHTML = '<div class="empty">Crunching the numbers…</div>';
    const a = await api(`/analytics/exam/${examId}`);
    if (!a.grades.length) { body.innerHTML = '<div class="card empty">No marks have been entered for this exam yet.</div>'; return; }
    gi = Math.min(gi, a.grades.length - 1);
    const draw = () => {
      const g = a.grades[gi], pos = ['first', '', 'third'], order = [1, 0, 2], ords = ['1st', '2nd', '3rd'];
      const pod = g.top3.length ? `<div class="podium">${order.filter((i) => g.top3[i]).map((i) => { const t = g.top3[i]; return `<div class="pod ${['first', 'second', 'third'][i]}"><div class="who"><div class="sm mut">${ords[i]}</div><div class="nm">${esc(t.name)}</div><div class="sm mut">${esc(t.className)}</div><div class="pct">${num(t.mean)}%</div><div class="sm mut">${esc(t.grade || '')}</div></div><div class="step">${i + 1}</div></div>`; }).join('')}</div>` : '<div class="empty">Not enough complete results to rank yet.</div>';
      const distOrder = g.scheme === 'cbc' ? ['EE1', 'EE2', 'ME1', 'ME2', 'AE1', 'AE2', 'BE1', 'BE2'] : ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'E'];
      const dist = distOrder.filter((k) => g.gradeDistribution[k]).map((k) => ({ label: k, value: g.gradeDistribution[k], color: bandVar(gradeBand(k)) }));
      const best = g.bestBySubject;
      document.getElementById('gbody').innerHTML = `${bandLegend()}
      <div class="grid g4">${stat('Students', g.students)}${stat('Ranked', g.ranked, { sub: g.students - g.ranked ? `${g.students - g.ranked} without a full result` : 'everyone' })}${stat('Grade mean', g.mean != null ? num(g.mean) + '%' : '—', { tone: bandTone(g.mean), sub: band(g.mean) ? BAND_LABELS[band(g.mean)] : '' })}${stat('Missed the exam', g.missedCount, { tone: g.missedCount === 0 ? 'b5' : g.missedCount <= 4 ? 'b3' : 'b2', sub: g.missedCount === 0 ? 'Everyone sat it' : 'No marks at all' })}</div>
      <div class="card" style="margin-top:16px"><h2>Top performers</h2>${pod}</div>
      <div class="grid g2" style="margin-top:16px">
        <div class="card"><h2 style="margin-bottom:10px">Class comparison (mean %)</h2>${barChart(g.classes.filter((c) => c.mean != null).map((c, i) => ({ label: c.name, value: c.mean, color: bandColor(c.mean) })), { max: 100, unit: '%', title: 'Mean score by class' })}</div>
        <div class="card"><h2 style="margin-bottom:10px">Grade distribution</h2>${barChart(dist, { title: 'Students per overall grade' })}</div></div>
      <div class="card" style="margin-top:16px"><h2 style="margin-bottom:10px">Subjects, strongest to weakest</h2>${hbarChart([...g.subjects].filter((s) => s.mean != null).sort((a, b) => b.mean - a.mean).map((s) => ({ label: s.name, value: s.mean })), { max: 100, unit: '%', title: 'Mean score by subject', colorFn: (it) => bandColor(it.value) })}</div>
      <div class="card pad0" style="margin-top:16px"><div class="card-h">Class × subject <span class="sm mut">★ best class per subject</span></div>
        ${table(['Class', 'Mean', ...g.subjects.map((s) => esc(s.name))], g.classes.map((c) => [`<span class="b">${esc(c.name)}</span>`, c.mean != null ? `<span class="hm b${band(c.mean)}">${num(c.mean)}%</span>` : '—', ...g.subjects.map((s) => (c.perSubject[s.id] != null ? `<span class="hm b${band(c.perSubject[s.id])}" title="${esc(BAND_LABELS[band(c.perSubject[s.id])])}">${best[s.id] === c.classId ? '★ ' : ''}${num(c.perSubject[s.id])}%</span>` : '<span class="mut">—</span>'))]))}</div>
      <div class="grid g2" style="margin-top:16px;align-items:start">
        <div class="card pad0"><div class="card-h">Subject champions</div>${table(['Subject', 'Top student', 'Score'], g.subjects.filter((s) => s.champion).map((s) => [esc(s.name), `${esc(s.champion.name)} <span class="mut sm">${esc(s.champion.className)}</span>`, `<b>${num(s.champion.score)}%</b>`]))}</div>
        <div class="card pad0"><div class="card-h">Movers since last exam</div>${a.hasPrevious ? `<div class="card-b">
          <div class="b sm" style="color:var(--b4ink)">Most improved</div>${g.improved.length ? g.improved.map((m) => `<div class="row sm" style="justify-content:space-between"><span>${esc(m.name)} <span class="mut">${esc(m.className)}</span></span><b style="color:var(--b4ink)">+${num(m.change)}</b></div>`).join('') : '<div class="mut sm">None</div>'}
          <div class="b sm" style="color:var(--b1ink);margin-top:12px">Biggest drops</div>${g.dropped.length ? g.dropped.map((m) => `<div class="row sm" style="justify-content:space-between"><span>${esc(m.name)} <span class="mut">${esc(m.className)}</span></span><b style="color:var(--b1ink)">${num(m.change)}</b></div>`).join('') : '<div class="mut sm">None</div>'}</div>` : '<div class="empty">Needs a previous exam to compare with.</div>'}</div></div>
      ${g.missed.length || g.ineligible.length ? `<div class="card pad0" style="margin-top:16px"><div class="card-h">Needs attention</div><div class="card-b">
        ${g.missed.length ? `<div class="b sm">No marks at all (${g.missed.length})</div><p class="sm">${g.missed.map((m) => `${esc(m.name)} <span class="mut">(${esc(m.className)})</span>`).join(', ')}</p>` : ''}
        ${g.ineligible.length ? `<div class="b sm" style="margin-top:8px">No overall result, not enough subjects (${g.ineligible.length})</div>${g.ineligible.map((m) => `<div class="sm">${esc(m.name)} <span class="mut">(${esc(m.className)})</span>: ${esc(m.reason)}</div>`).join('')}` : ''}</div></div>` : ''}`;
    };
    body.innerHTML = `${a.grades.length > 1 ? `<div class="tabs" id="gtabs">${a.grades.map((g, i) => `<button class="tab ${i === gi ? 'on' : ''}" data-i="${i}">${esc(g.grade)}</button>`).join('')}</div>` : ''}<div id="gbody" class="fade"></div>`;
    $$('#gtabs .tab', body).forEach((b) => (b.onclick = () => { gi = +b.dataset.i; $$('#gtabs .tab', body).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
    draw();
  };
  $('#exam', el).onchange = (e) => { examId = e.target.value; gi = 0; load().catch((x) => toast(x.message, 'bad')); };
  await load();
}


// ---------- Students to watch (early warning) ----------
async function watch(el, ctx) {
  const ov = await api('/analytics/overview');
  if (!ov.exams.length) { el.innerHTML = `${ctx.bar('Students to watch')}<div class="card empty">Once you have an exam with marks, students who may need help will be listed here.</div>`; return; }
  let examId = ov.exams[0].id, level = '', cls = '', data = null;
  el.innerHTML = `${ctx.bar('Students to watch', 'An early warning from each student’s recent exams', `<span id="sel"></span><button class="btn no-print" id="pr">Print</button>`)}<div id="body"><div class="empty">Looking at the trends…</div></div>`;
  $('#sel', el).innerHTML = examSelect(ov.exams, examId);
  const lvPill = (l) => (l === 'high' ? pill('Needs attention', 'bad') : l === 'medium' ? pill('Concern', 'warn') : pill('Keep an eye', 'info'));
  const draw = () => {
    const classes = [...new Set(data.items.map((i) => i.className))].sort();
    const items = data.items.filter((i) => (!level || i.level === level) && (!cls || i.className === cls));
    $('#body', el).innerHTML = `<div class="grid g3">${stat('Need attention', data.counts.high, { tone: 'red' })}${stat('Concern', data.counts.medium, { tone: 'gold' })}${stat('Keep an eye', data.counts.watch, { tone: 'navy' })}</div>
      <div class="row no-print" style="margin:16px 0"><select class="i" id="lv" style="width:auto"><option value="">All levels</option><option value="high">Needs attention</option><option value="medium">Concern</option><option value="watch">Keep an eye</option></select>
        <select class="i" id="cl" style="width:auto"><option value="">All classes</option>${classes.map((c) => `<option>${esc(c)}</option>`).join('')}</select><span class="mut sm">${items.length} of ${data.total} student(s)${data.total > data.items.length ? ` (showing the ${data.items.length} most urgent)` : ''}</span></div>
      ${items.length ? items.map((i) => `<div class="card" style="margin-bottom:10px"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><b style="font-size:15px">${esc(i.name)}</b> <span class="mut sm">${esc(i.className)} · Adm ${esc(i.admissionNo)}</span>
        <div class="sm mut">${i.mean != null ? `Latest mean ${num(i.mean)}%` : 'No overall mean'}${i.change != null ? ` · ${i.change > 0 ? '+' : ''}${num(i.change)} since ${esc(data.previous?.name || 'last exam')}` : ''}</div></div>${lvPill(i.level)}</div>
        <ul class="sm" style="margin:8px 0 0;padding-left:18px">${i.flags.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul></div>`).join('') : `<div class="card empty">${data.total ? 'No students match those filters.' : 'Nobody is flagged for this exam. 🎉'}</div>`}
      <p class="sm mut" style="margin-top:14px">These flags come from simple, visible rules (a drop of 10+ points, falling for three exams, several subjects under 30%, well below the KCPE-based target, or missing the exam), not a prediction. They show who to talk to first. They need at least two exams to compare trends.</p>`;
    $('#lv', el).value = level; $('#cl', el).value = cls;
    $('#lv', el).onchange = (e) => { level = e.target.value; draw(); }; $('#cl', el).onchange = (e) => { cls = e.target.value; draw(); };
  };
  const load = async () => { $('#body', el).innerHTML = '<div class="empty">Looking at the trends…</div>'; data = await api(`/analytics/risk?examId=${examId}`); draw(); };
  $('#exam', el).onchange = (e) => { examId = e.target.value; load().catch((x) => toast(x.message, 'bad')); };
  $('#pr', el).onclick = () => window.print();
  await load();
}

// ---------- Report cards ----------
async function reportcards(el, ctx) {
  const [exams, classes, st] = await Promise.all([api('/exams'), api('/classes'), api('/school-settings')]);
  if (!exams.length || !classes.length) { el.innerHTML = `${ctx.bar('Report cards')}<div class="card empty">Add classes and an exam first, then your report cards appear here.</div>`; return; }
  let cards = [], exam = null, tpl = st.school.reportCardTemplate;
  const o = cardOptions();
  el.innerHTML = `${ctx.bar('Report cards', 'Print a whole class, a stream, or a whole grade in one go')}
  <div class="card no-print"><div class="form-grid">
    <div><label class="f">Exam</label>${examSelect(exams, exams[0].id)}</div>
    <div><label class="f" for="cls">Class</label><select class="i" id="cls">${classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
    <div><label class="f" for="scope">Print</label><select class="i" id="scope"><option value="class">This class only</option><option value="grade">The whole grade (all streams)</option></select></div>
    <div><label class="f" for="gf">Overall grade</label><select class="i" id="gf"><option value="">All grades</option></select></div>
    <div><label class="f" for="tpl">Template</label><select class="i" id="tpl"><option value="classic">Classic form (printed)</option><option value="modern">Modern (on screen)</option></select></div></div>
    <details style="margin-top:14px"><summary class="b" style="cursor:pointer">Details printed on the card</summary><div class="form-grid" style="margin-top:12px">
      ${[['term', 'Term (e.g. TERM TWO)'], ['date', 'Date'], ['nextTerm', 'Next term begins'], ['classTeacher', 'Class teacher name'], ['principal', 'Principal name'], ['character', 'Character'], ['attendance', 'Attendance'], ['coCurricular', 'Co-curricular']]
        .map(([k, l]) => `<div><label class="f" for="o_${k}">${l}</label><input class="i" id="o_${k}" data-o="${k}" value="${esc(o[k])}"></div>`).join('')}</div></details>
    <div class="row" style="margin-top:16px"><button class="btn primary" id="pr">Print</button><button class="btn" id="pdf">Download PDF</button><button class="btn" id="file">Download printable file</button><span class="mut sm" id="cnt"></span></div>
    <p class="sm mut" style="margin:10px 0 0">PDF handles up to ${PDF_LIMIT} cards at a time. For more, use "Download printable file" or Print, then choose "Save as PDF".</p></div>
  <div id="preview" style="margin-top:8px"></div>`;
  $('#tpl', el).value = tpl;
  const opts = () => { const x = cardOptions(); $$('[data-o]', el).forEach((i) => (x[i.dataset.o] = i.value)); return x; };
  const visible = () => { const g = $('#gf', el).value; return cards.filter((c) => !g || c.summary.grade === g); };
  const html = () => { const x = opts(); return visible().map((c) => renderCard({ ...c, template: tpl }, exam, x)).join(''); };
  const name = () => `Report-cards-${(classes.find((c) => c.id === $('#cls', el).value)?.name || 'class').replace(/\s+/g, '_')}${$('#scope', el).value === 'grade' ? '-all-streams' : ''}`;
  const draw = () => {
    const v = visible(); $('#cnt', el).textContent = `${v.length} card${v.length === 1 ? '' : 's'}`;
    $('#preview', el).innerHTML = v.length ? `${v.slice(0, 2).map((c) => renderCard({ ...c, template: tpl }, exam, opts())).join('')}<div class="mut sm center no-print">Preview shows the first ${Math.min(2, v.length)} of ${v.length}.</div>` : '<div class="card empty">No report cards match.</div>';
  };
  const load = async () => {
    $('#preview', el).innerHTML = '<div class="empty">Loading cards…</div>';
    const r = await api(`/report-card/batch?examId=${$('#exam', el).value}&classId=${$('#cls', el).value}&scope=${$('#scope', el).value}`);
    cards = r.cards; exam = r.exam;
    const o2 = cardOptions(); if (!o2.term) { $('#o_term', el).value = termFromExam(exam); }
    const grades = [...new Set(cards.map((c) => c.summary.grade).filter(Boolean))];
    $('#gf', el).innerHTML = `<option value="">All grades</option>${grades.map((g) => `<option>${esc(g)}</option>`).join('')}`;
    draw();
  };
  ['exam', 'cls', 'scope'].forEach((id) => ($('#' + id, el).onchange = () => load().catch((e) => toast(e.message, 'bad'))));
  $('#gf', el).onchange = draw;
  $('#tpl', el).onchange = async (e) => { tpl = e.target.value; draw(); api('/school-settings', { method: 'PATCH', body: { reportCardTemplate: tpl } }).then(() => toast('Template saved for your school', 'ok')).catch(() => {}); };
  $$('[data-o]', el).forEach((i) => (i.onchange = () => { saveCardOptions(opts()); draw(); }));
  $('#pr', el).onclick = () => { if (!visible().length) return toast('Nothing to print.', 'bad'); saveCardOptions(opts()); printHtml(html()); };
  $('#file', el).onclick = (e) => run(e.currentTarget, () => { saveCardOptions(opts()); return downloadPrintable(html(), name()); });
  $('#pdf', el).onclick = (e) => run(e.currentTarget, async () => {
    const n = visible().length; if (!n) return toast('Nothing to download.', 'bad');
    if (n > PDF_LIMIT) return toast(`${n} cards is too many for one PDF. Filter by class or grade to get ${PDF_LIMIT} or fewer, or use the printable file.`, 'bad');
    saveCardOptions(opts()); toast(`Building PDF of ${n} cards…`); await downloadPdf(html(), name());
  });
  await load();
}

export const views = { overview, analytics, watch, reportcards, ...setup.views, ...promotion.views, ...importer.views, ...school.views, ...account.views, staff, audit };
