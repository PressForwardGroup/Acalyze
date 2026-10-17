import { api } from '../api.js';
import { esc, $, $$, num, kes, fmtDate, toast, run, table, stat, pill, modal, confirmBox, hbarChart, donut, progress } from '../ui.js';
import { printHtml, download } from './reportcard.js';

const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const todayIso = () => iso(new Date());
const locked = (el, ctx, title, what) => { el.innerHTML = `${ctx.bar(title)}<div class="card empty">${esc(what)} isn't included in your school's current plan.${ctx.role === 'admin' ? '<br><a class="btn gold" style="margin-top:14px" href="#/app/subscription">See your plan</a>' : '<br>Please ask your school admin.'}</div>`; };
const isLocked = (e) => e.status === 402;

// =====================================================================
// ATTENDANCE
// =====================================================================
const ST = [['present', 'P', 'Present', 'ok'], ['absent', 'A', 'Absent', 'bad'], ['late', 'L', 'Late', 'warn'], ['excused', 'E', 'Excused', 'info']];

async function attendance(el, ctx) {
  const isAdmin = ctx.role === 'admin';
  let classes;
  try {
    classes = await api('/classes');
    if (!isAdmin) {
      const [teachers, mine] = await Promise.all([api('/teachers'), api('/student-transfer/class-results/mine')]);
      const ids = new Set([...(teachers.find((t) => t.id === ctx.me.id)?.assignments || []).map((a) => a.class_id), ...mine.map((c) => c.id)]);
      classes = classes.filter((c) => ids.has(c.id));
    }
    await api(`/attendance/class?classId=${classes[0]?.id || ''}&day=${todayIso()}`).catch((e) => { if (isLocked(e)) throw e; });
  } catch (e) { if (isLocked(e)) return locked(el, ctx, 'Attendance', 'Attendance'); throw e; }
  if (!classes.length) { el.innerHTML = `${ctx.bar('Attendance')}<div class="card empty">${isAdmin ? 'Add a class first.' : 'You have no classes yet. Your admin assigns them.'}</div>`; return; }

  let tab = isAdmin ? 'summary' : 'mark';
  const draw = () => {
    el.innerHTML = `${ctx.bar('Attendance', 'Daily register and school-wide attendance')}
    ${isAdmin ? `<div class="tabs"><button class="tab ${tab === 'summary' ? 'on' : ''}" data-t="summary">Summary</button><button class="tab ${tab === 'mark' ? 'on' : ''}" data-t="mark">Take the register</button></div>` : ''}<div id="pane"></div>`;
    $$('.tab', el).forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    (tab === 'summary' ? summaryPane : markPane)($('#pane', el));
  };

  async function markPane(pane) {
    let cls = classes[0].id, day = todayIso(), state = {}, rows = [];
    const tomorrow = iso(new Date(Date.now() + 86400000));
    pane.innerHTML = `<div class="card"><div class="form-grid"><div><label class="f" for="cl">Class</label><select class="i" id="cl">${classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div><label class="f" for="day">Date</label><input class="i" id="day" type="date" value="${day}" max="${tomorrow}"></div></div>
      <div class="legend" style="margin-top:12px">${ST.map(([, l, t, c]) => `<span><span class="pill ${c}">${l}</span> ${t}</span>`).join('')}</div></div><div id="reg" style="margin-top:16px"></div>`;
    const paint = () => {
      const marked = Object.values(state).filter(Boolean).length, counts = Object.fromEntries(ST.map(([k]) => [k, Object.values(state).filter((v) => v === k).length]));
      $('#reg', pane).innerHTML = rows.length ? `<div class="card pad0"><div class="card-h"><span>${marked} of ${rows.length} marked <span class="mut sm">· ${ST.map(([k, , t]) => `${counts[k]} ${t.toLowerCase()}`).join(' · ')}</span></span>
        <span class="row" style="gap:8px"><button class="btn sm" id="allp">Mark all present</button><button class="btn sm primary" id="save">Save register</button></span></div>
        ${rows.map((r) => `<div class="att-row"><span class="att-name">${esc(r.full_name)} <span class="mut sm">${esc(r.school_id_number)}</span></span><span class="att-btns" data-s="${r.student_id}">${ST.map(([k, l, t, c]) => `<button type="button" class="att-b ${c} ${state[r.student_id] === k ? 'on' : ''}" data-k="${k}" title="${t}" aria-label="${t}" aria-pressed="${state[r.student_id] === k}">${l}</button>`).join('')}</span></div>`).join('')}</div>` : '<div class="card empty">No students in this class.</div>';
      $$('.att-btns', pane).forEach((g) => $$('.att-b', g).forEach((b) => (b.onclick = () => { const id = g.dataset.s; state[id] = state[id] === b.dataset.k ? null : b.dataset.k; paint(); })));
      $('#allp', pane)?.addEventListener('click', () => { rows.forEach((r) => { if (!state[r.student_id]) state[r.student_id] = 'present'; }); paint(); });
      $('#save', pane)?.addEventListener('click', (e) => run(e.currentTarget, async () => {
        const records = rows.filter((r) => state[r.student_id]).map((r) => ({ studentId: r.student_id, status: state[r.student_id] }));
        if (!records.length) return toast('Mark at least one student first.', 'bad');
        const r = await api('/attendance/class', { method: 'PUT', body: { classId: cls, day, records } });
        toast(`Saved ${r.saved} student${r.saved === 1 ? '' : 's'}${records.length < rows.length ? ` (${rows.length - records.length} not marked)` : ''}`, 'ok');
      }));
    };
    const load = async () => { $('#reg', pane).innerHTML = '<div class="empty">Loading…</div>'; const r = await api(`/attendance/class?classId=${cls}&day=${day}`); rows = r.rows; state = Object.fromEntries(rows.map((x) => [x.student_id, x.status])); paint(); };
    $('#cl', pane).onchange = (e) => { cls = e.target.value; load().catch((x) => toast(x.message, 'bad')); };
    $('#day', pane).onchange = (e) => { if (e.target.value) { day = e.target.value; load().catch((x) => toast(x.message, 'bad')); } };
    await load();
  }

  async function summaryPane(pane) {
    let span = 30;
    const load = async () => {
      pane.innerHTML = '<div class="empty">Loading…</div>';
      const to = todayIso(), from = iso(new Date(Date.now() - span * 86400000));
      const s = await api(`/attendance/summary?from=${from}&to=${to}`);
      const c = s.counts, toneOf = (r) => (r == null ? 'var(--c4)' : r >= 92 ? 'var(--c3)' : r >= 85 ? 'var(--c2)' : 'var(--c5)');
      pane.innerHTML = `<div class="row" style="margin-bottom:14px"><label class="f" for="span" style="margin:0">Show the last</label><select class="i" id="span" style="width:auto">${[7, 30, 90].map((n) => `<option value="${n}" ${n === span ? 'selected' : ''}>${n} days</option>`).join('')}</select></div>
        <div class="grid g4">${stat('Attendance rate', s.overallRate == null ? '—' : num(s.overallRate) + '%', { tone: 'green', sub: 'present + late' })}${stat('Present', c.present, { tone: 'navy' })}${stat('Late', c.late, { tone: 'gold' })}${stat('Absent', c.absent, { tone: 'red', sub: c.excused ? `${c.excused} excused` : '' })}</div>
        <div class="grid g2" style="margin-top:16px"><div class="card"><h2 style="margin-bottom:10px">Attendance rate by class</h2>${hbarChart(s.classes.filter((x) => x.rate != null).map((x) => ({ label: x.name, value: x.rate })), { max: 100, unit: '%', title: 'Attendance rate by class', colorFn: (it) => toneOf(it.value) })}${s.classes.some((x) => x.rate == null) ? '<p class="sm mut">Classes with no register taken in this period are not shown.</p>' : ''}</div>
        <div class="card pad0"><div class="card-h">Most days absent</div>${table(['Student', 'Class', 'Absent', 'Late'], s.frequentAbsentees.map((x) => [`<b>${esc(x.full_name)}</b>`, esc(x.class_name || '—'), `<b style="color:var(--bad)">${x.absent}</b>`, x.late]), { empty: 'Nobody has been absent 3 or more days.' })}</div></div>`;
      $('#span', pane).onchange = (e) => { span = +e.target.value; load().catch((x) => toast(x.message, 'bad')); };
    };
    await load();
  }
  draw();
}

// =====================================================================
// FEES
// =====================================================================
export function receiptHtml(d) {
  const p = d.payment, s = d.school, row = (a, b) => `<tr><td style="width:36%"><b>${a}</b></td><td>${b}</td></tr>`;
  return `<div class="rcpt">${s.logo_url ? `<img class="logo" src="${esc(s.logo_url)}" alt="">` : ''}<h2>${esc(s.name)}</h2>${s.motto ? `<div class="mo">${esc(s.motto)}</div>` : ''}
    <div class="ti">FEE RECEIPT</div>
    <table>${row('Receipt no.', `<b>${esc(p.receipt_no)}</b>`)}${row('Date', esc(fmtDate(p.paid_on)))}${row('Received from', `${esc(p.full_name)} <span class="sm">(Adm ${esc(p.school_id_number)}${p.class_name ? ', ' + esc(p.class_name) : ''})</span>`)}
      ${row('Academic year', esc(p.academic_year))}${row('Amount received', `<b style="font-size:15px">${kes(p.amount)}</b>`)}${row('Paid by', `${esc(p.method.toUpperCase())}${p.reference ? ' · ' + esc(p.reference) : ''}`)}${p.note ? row('Note', esc(p.note)) : ''}</table>
    <table style="margin-top:8px">${row('Total fees for the year', kes(d.charged))}${row('Paid to date (including this)', kes(d.paidToDate))}${row('Balance', `<b>${kes(d.balanceAfter)}</b>`)}</table>
    <div class="ln" style="margin-top:22px">Received by: <span class="bl"></span> &nbsp; Signature &amp; stamp: <span class="bl"></span></div></div>`;
}
export async function printReceipt(id) { printHtml(receiptHtml(await api(`/fees/receipt/${id}`))); }

async function fees(el, ctx) {
  let yearsData;
  try { yearsData = await api('/fees/items'); } catch (e) { if (isLocked(e)) return locked(el, ctx, 'Fees', 'School fees'); throw e; }
  const classes = await api('/classes');
  const grades = [...new Set(classes.map((c) => c.grade))];
  const cur = String(new Date().getFullYear());
  const years = [...new Set([cur, ...yearsData.years])].sort().reverse();
  let tab = 'overview', year = cur;
  const draw = () => {
    el.innerHTML = `${ctx.bar('School fees', 'Charges, payments, balances and receipts', `<select class="i" id="yr" style="width:auto" aria-label="Academic year">${years.map((y) => `<option ${y === year ? 'selected' : ''}>${esc(y)}</option>`).join('')}</select>`)}
      <div class="tabs">${[['overview', 'Overview'], ['pay', 'Record a payment'], ['items', 'Charges'], ['bal', 'Balances']].map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div><div id="pane"></div>`;
    $$('.tab', el).forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    $('#yr', el).onchange = (e) => { year = e.target.value; draw(); };
    ({ overview, pay, items, bal })[tab]($('#pane', el)).catch((e) => toast(e.message, 'bad'));
  };

  async function overview(p) {
    const b = await api(`/fees/balances?year=${year}`), s = b.summary;
    if (!s.charged && !s.collected) { p.innerHTML = '<div class="card empty">No fees set up for this year yet.<br>Add your charges first (the Charges tab), then record payments as they come in.</div>'; return; }
    const owing = b.rows.filter((r) => r.balance > 0).sort((x, y) => y.balance - x.balance).slice(0, 10);
    p.innerHTML = `<div class="grid g4">${stat('Total charged', kes(s.charged), { tone: 'navy' })}${stat('Collected', kes(s.collected), { tone: 'green' })}${stat('Outstanding', kes(s.outstanding), { tone: 'red', sub: `${s.studentsOwing} of ${s.students} students owe` })}${stat('Collection rate', s.collectionRate == null ? '—' : num(s.collectionRate) + '%', { tone: 'gold' })}</div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><h2 style="margin-bottom:10px">Collected vs outstanding</h2>${donut([{ label: 'Collected', value: Math.round(s.collected) }, { label: 'Outstanding', value: Math.round(s.outstanding) }].filter((x) => x.value), { center: s.collectionRate == null ? '' : num(s.collectionRate) + '%', title: 'Fees collected versus outstanding' })}</div>
        <div class="card"><h2 style="margin-bottom:10px">Collection rate by class</h2>${hbarChart(s.byClass.filter((c) => c.rate != null).map((c) => ({ label: c.class_name, value: c.rate })), { max: 100, unit: '%', title: 'Collection rate by class', colorFn: (it) => (it.value >= 85 ? 'var(--c3)' : it.value >= 60 ? 'var(--c2)' : 'var(--c5)') })}</div></div>
      <div class="card pad0" style="margin-top:16px"><div class="card-h">Highest balances</div>${table(['Student', 'Class', 'Charged', 'Paid', 'Balance'], owing.map((r) => [`<b>${esc(r.full_name)}</b>`, esc(r.class_name || '—'), kes(r.charged), kes(r.paid), `<b style="color:var(--bad)">${kes(r.balance)}</b>`]), { empty: 'Nobody owes anything. 🎉' })}</div>`;
  }

  async function pay(p) {
    const [students, recent] = await Promise.all([api('/students'), api('/fees/payments')]);
    let chosen = null;
    p.innerHTML = `<div class="card"><h2 style="margin-bottom:12px">Record a payment</h2><div class="form-grid">
      <div style="grid-column:1/-1"><label class="f" for="q">Find the student (name or admission number)</label><input class="i" id="q" placeholder="Start typing…" autocomplete="off"><div id="hits" style="margin-top:6px"></div></div>
      <div><label class="f" for="amt">Amount (KSh) *</label><input class="i" id="amt" inputmode="decimal" placeholder="e.g. 15000"></div>
      <div><label class="f" for="mth">Paid by</label><select class="i" id="mth"><option value="mpesa">M-Pesa</option><option value="cash">Cash</option><option value="bank">Bank</option><option value="other">Other</option></select></div>
      <div><label class="f" for="ref">Reference (e.g. M-Pesa code)</label><input class="i" id="ref"></div><div><label class="f" for="dt">Date paid</label><input class="i" id="dt" type="date" value="${todayIso()}"></div>
      <div style="grid-column:1/-1"><label class="f" for="note">Note (optional)</label><input class="i" id="note" maxlength="200"></div></div>
      <p id="who" class="sm" style="margin:12px 0 0"></p><button class="btn primary" id="rec" style="margin-top:10px" disabled>Record payment &amp; make receipt</button></div>
      <div class="card pad0" style="margin-top:18px"><div class="card-h">Recent payments</div>${table(['Receipt', 'Student', 'Amount', 'Paid by', 'Date', ''], recent.map((r) => [`<b>${esc(r.receipt_no)}</b>`, `${esc(r.full_name)} <span class="mut sm">${esc(r.school_id_number)}</span>`, `<b>${kes(r.amount)}</b>`, esc(r.method.toUpperCase()) + (r.reference ? ` <span class="mut sm">${esc(r.reference)}</span>` : ''), fmtDate(r.paid_on), `<div class="row" style="gap:6px"><button class="btn sm" data-rc="${r.id}">Receipt</button><button class="btn sm danger" data-vd="${r.id}">Void</button></div>`]), { empty: 'No payments recorded yet.' })}</div>`;
    const show = () => { $('#who', p).innerHTML = chosen ? `Paying for <b>${esc(chosen.full_name)}</b> <span class="mut">(Adm ${esc(chosen.school_id_number)})</span>` : '<span class="mut">Choose a student above.</span>'; $('#rec', p).disabled = !chosen; };
    $('#q', p).oninput = (e) => {
      const q = e.target.value.trim().toLowerCase(); chosen = null; show();
      const hits = q.length < 2 ? [] : students.filter((s) => `${s.full_name} ${s.school_id_number}`.toLowerCase().includes(q)).slice(0, 8);
      $('#hits', p).innerHTML = hits.map((s) => `<button type="button" class="btn sm" style="margin:0 6px 6px 0" data-pick="${s.id}">${esc(s.full_name)} · ${esc(s.school_id_number)}</button>`).join('') || (q.length >= 2 ? '<span class="mut sm">No match.</span>' : '');
      $$('[data-pick]', p).forEach((b) => (b.onclick = () => { chosen = students.find((s) => s.id === b.dataset.pick); $('#q', p).value = chosen.full_name; $('#hits', p).innerHTML = ''; show(); }));
    };
    show();
    $('#rec', p).onclick = (e) => run(e.currentTarget, async () => {
      const r = await api('/fees/payments', { method: 'POST', body: { studentId: chosen.id, amount: $('#amt', p).value, method: $('#mth', p).value, reference: $('#ref', p).value, paidOn: $('#dt', p).value, academicYear: year, note: $('#note', p).value } });
      toast(`Recorded ${kes(r.amount)}, receipt ${r.receipt_no}`, 'ok');
      modal(`<h3>Payment recorded</h3><p>${kes(r.amount)} from <b>${esc(chosen.full_name)}</b>.<br>Receipt number <span class="secret">${esc(r.receipt_no)}</span></p><div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-close>Close</button><button class="btn primary" id="pr">Print receipt</button></div>`, { onMount: (m) => { $('#pr', m).onclick = () => printReceipt(r.id).catch((x) => toast(x.message, 'bad')); } });
      pay(p);
    });
    $$('[data-rc]', p).forEach((b) => (b.onclick = () => run(b, () => printReceipt(b.dataset.rc))));
    $$('[data-vd]', p).forEach((b) => (b.onclick = async () => { if (await confirmBox('Void this payment? It is removed and the balance goes back up. This cannot be undone.', 'Void payment')) run(b, async () => { await api(`/fees/payments/${b.dataset.vd}`, { method: 'DELETE' }); toast('Payment voided', 'ok'); pay(p); }); }));
  }

  async function items(p) {
    const it = await api(`/fees/items?year=${year}`);
    p.innerHTML = `<div class="card"><h2 style="margin-bottom:12px">Add a charge for ${esc(year)}</h2><div class="form-grid">
      <div><label class="f" for="nm">Name *</label><input class="i" id="nm" placeholder="Tuition"></div><div><label class="f" for="am">Amount (KSh) *</label><input class="i" id="am" inputmode="decimal"></div>
      <div><label class="f" for="tm">Term</label><select class="i" id="tm"><option value="">Whole year</option><option>Term 1</option><option>Term 2</option><option>Term 3</option></select></div>
      <div><label class="f" for="gr">Applies to</label><select class="i" id="gr"><option value="">Every student</option>${grades.map((g) => `<option>${esc(g)}</option>`).join('')}</select></div></div>
      <p class="sm mut">A charge for "Form 3" only counts for students in Form 3 classes. A student's balance for the year is every charge that applies to them, minus what they have paid.</p><button class="btn primary" id="add">Add charge</button></div>
    <div class="card pad0" style="margin-top:18px">${table(['Charge', 'Applies to', 'Term', 'Amount', ''], it.items.map((x) => [`<b>${esc(x.name)}</b>`, esc(x.grade || 'Everyone'), esc(x.term || 'Whole year'), kes(x.amount), `<button class="btn sm danger" data-del="${x.id}">Delete</button>`]), { empty: `No charges for ${year} yet.` })}${it.items.length ? `<div class="card-b" style="text-align:right"><span class="mut">Total for one student who is charged everything: </span><b>${kes(it.items.filter((x) => !x.grade).reduce((n, x) => n + x.amount, 0))}</b> <span class="mut sm">(plus any grade-specific charges)</span></div>` : ''}</div>`;
    $('#add', p).onclick = (e) => run(e.currentTarget, async () => { if (!$('#nm', p).value.trim()) return toast('Give the charge a name.', 'bad'); await api('/fees/items', { method: 'POST', body: { name: $('#nm', p).value, amount: $('#am', p).value, academicYear: year, term: $('#tm', p).value || null, grade: $('#gr', p).value || null } }); toast('Charge added', 'ok'); items(p); });
    $$('[data-del]', p).forEach((b) => (b.onclick = async () => { if (await confirmBox('Delete this charge? Balances change straight away.', 'Delete')) run(b, async () => { await api(`/fees/items/${b.dataset.del}`, { method: 'DELETE' }); items(p); }); }));
  }

  async function bal(p) {
    let cls = '', onlyOwing = false, data = null;
    p.innerHTML = `<div class="row" style="margin-bottom:14px"><select class="i" id="cf" style="width:auto"><option value="">All classes</option>${classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <label class="row" style="gap:6px"><input type="checkbox" id="ow"> Only students who owe</label><span class="grow"></span><button class="btn sm" id="csv">Download CSV</button></div><div id="tb"></div>`;
    const paint = () => { const rows = data.rows.filter((r) => !onlyOwing || r.balance > 0); $('#tb', p).innerHTML = `<div class="card pad0">${table(['Student', 'Adm no.', 'Class', 'Charged', 'Paid', 'Balance'], rows.map((r) => [`<b>${esc(r.full_name)}</b>`, esc(r.school_id_number), esc(r.class_name || '—'), kes(r.charged), kes(r.paid), `<b style="color:${r.balance > 0 ? 'var(--bad)' : 'var(--ok)'}">${kes(r.balance)}</b>`]), { empty: 'No students match.' })}</div>`; };
    const load = async () => { data = await api(`/fees/balances?year=${year}${cls ? `&classId=${cls}` : ''}`); paint(); };
    $('#cf', p).onchange = (e) => { cls = e.target.value; load().catch((x) => toast(x.message, 'bad')); };
    $('#ow', p).onchange = (e) => { onlyOwing = e.target.checked; paint(); };
    $('#csv', p).onclick = () => { const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`; download(`fee-balances-${year}.csv`, ['Student,Admission no,Class,Charged,Paid,Balance', ...data.rows.filter((r) => !onlyOwing || r.balance > 0).map((r) => [q(r.full_name), q(r.school_id_number), q(r.class_name), r.charged, r.paid, r.balance].join(','))].join('\n'), 'text/csv'); };
    await load();
  }
  draw();
}

// =====================================================================
// CALENDAR
// =====================================================================
const KINDS = { term: ['Term dates', 'var(--c1)'], exam: ['Exam', 'var(--c5)'], holiday: ['Holiday', 'var(--c3)'], meeting: ['Meeting', 'var(--c2)'], event: ['Event', 'var(--c4)'] };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

async function calendar(el, ctx) {
  const yr = new Date().getFullYear();
  let events;
  try { events = await api(`/calendar?from=${yr - 1}-01-01&to=${yr + 2}-12-31`); } catch (e) { if (isLocked(e)) return locked(el, ctx, 'Calendar', 'The school calendar'); throw e; }
  const isAdmin = ctx.role === 'admin';
  let view = new Date(); view = new Date(view.getFullYear(), view.getMonth(), 1);
  const on = (day) => events.filter((e) => e.starts_on <= day && (e.ends_on || e.starts_on) >= day);
  const draw = () => {
    const y = view.getFullYear(), m = view.getMonth(), first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, dim = new Date(y, m + 1, 0).getDate();
    const cells = [...Array(lead).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)]; while (cells.length % 7) cells.push(null);
    const monthEvents = events.filter((e) => e.starts_on <= iso(new Date(y, m, dim)) && (e.ends_on || e.starts_on) >= iso(first));
    el.innerHTML = `${ctx.bar('Calendar', 'Terms, exams, holidays and events')}
    <div class="card pad0"><div class="card-h"><button class="btn sm" id="prev" aria-label="Previous month">‹</button><span style="font-family:var(--serif);font-size:18px">${MONTHS[m]} ${y}</span><span class="row" style="gap:6px"><button class="btn sm" id="tod">Today</button><button class="btn sm" id="next" aria-label="Next month">›</button></span></div>
      <div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="cal-h">${d}</div>`).join('')}${cells.map((d) => {
        if (!d) return '<div class="cal-d off"></div>';
        const day = iso(new Date(y, m, d)), ev = on(day);
        return `<div class="cal-d ${day === todayIso() ? 'today' : ''}"><span class="cal-n">${d}</span>${ev.slice(0, 3).map((e) => `<span class="cal-e" style="background:${KINDS[e.kind][1]}" title="${esc(e.title)}">${esc(e.title)}</span>`).join('')}${ev.length > 3 ? `<span class="sm mut">+${ev.length - 3} more</span>` : ''}</div>`;
      }).join('')}</div></div>
    <div class="legend" style="margin:12px 0">${Object.entries(KINDS).map(([, [l, c]]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>
    <div class="card pad0"><div class="card-h">This month</div>${monthEvents.length ? monthEvents.map((e) => `<div class="att-row"><span><span class="pill" style="background:${KINDS[e.kind][1]};color:${e.kind === 'meeting' ? '#1B1405' : '#fff'}">${KINDS[e.kind][0]}</span> <b>${esc(e.title)}</b>${e.audience === 'staff' ? ' <span class="pill">Staff only</span>' : ''}<div class="sm mut">${fmtDate(e.starts_on)}${e.ends_on && e.ends_on !== e.starts_on ? ' to ' + fmtDate(e.ends_on) : ''}${e.description ? ' · ' + esc(e.description) : ''}</div></span>${isAdmin ? `<button class="btn sm danger" data-del="${e.id}">Delete</button>` : ''}</div>`).join('') : '<div class="empty">Nothing scheduled this month.</div>'}</div>
    ${isAdmin ? `<div class="card" style="margin-top:16px"><h2 style="margin-bottom:12px">Add to the calendar</h2><div class="form-grid">
      <div><label class="f" for="t">Title *</label><input class="i" id="t" placeholder="Term 2 opens"></div>
      <div><label class="f" for="k">Type</label><select class="i" id="k">${Object.entries(KINDS).map(([k, [l]]) => `<option value="${k}" ${k === 'event' ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label class="f" for="s">Starts *</label><input class="i" id="s" type="date" value="${todayIso()}"></div><div><label class="f" for="e">Ends (optional)</label><input class="i" id="e" type="date"></div>
      <div style="grid-column:1/-1"><label class="f" for="d">Details (optional)</label><input class="i" id="d" maxlength="500"></div></div>
      <label class="row" style="gap:8px;margin:12px 0"><input type="checkbox" id="st"> Staff only (hide from parents)</label><button class="btn primary" id="add">Add event</button></div>` : ''}`;
    $('#prev', el).onclick = () => { view = new Date(y, m - 1, 1); draw(); }; $('#next', el).onclick = () => { view = new Date(y, m + 1, 1); draw(); };
    $('#tod', el).onclick = () => { const n = new Date(); view = new Date(n.getFullYear(), n.getMonth(), 1); draw(); };
    $('#add', el)?.addEventListener('click', (e) => run(e.currentTarget, async () => {
      if (!$('#t', el).value.trim()) return toast('Give the event a title.', 'bad');
      const ev = await api('/calendar', { method: 'POST', body: { title: $('#t', el).value, kind: $('#k', el).value, startsOn: $('#s', el).value, endsOn: $('#e', el).value || undefined, description: $('#d', el).value, audience: $('#st', el).checked ? 'staff' : 'all' } });
      events.push(ev); events.sort((a, b) => a.starts_on.localeCompare(b.starts_on)); toast('Added to the calendar', 'ok'); view = new Date(`${ev.starts_on}T00:00:00`); view = new Date(view.getFullYear(), view.getMonth(), 1); draw();
    }));
    $$('[data-del]', el).forEach((b) => (b.onclick = async () => { if (await confirmBox('Remove this event?', 'Remove')) run(b, async () => { await api(`/calendar/${b.dataset.del}`, { method: 'DELETE' }); events = events.filter((x) => x.id !== b.dataset.del); draw(); }); }));
  };
  draw();
}

export const views = { attendance, fees, calendar };
