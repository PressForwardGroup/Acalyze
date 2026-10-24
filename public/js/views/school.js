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
    ${p.reversed_at ? `<div style="border:2px solid #b3261e;color:#b3261e;text-align:center;padding:6px;margin:8px 0;font-weight:700">REVERSED on ${esc(fmtDate(p.reversed_at))}<div class="sm" style="font-weight:400">${esc(p.reversal_reason || '')}</div></div>` : ''}
    <table>${row('Receipt no.', `<b>${esc(p.receipt_no)}</b>`)}${row('Date', esc(fmtDate(p.paid_on)))}${row('Received from', `${esc(p.full_name)} <span class="sm">(Adm ${esc(p.school_id_number)}${p.class_name ? ', ' + esc(p.class_name) : ''})</span>`)}
      ${row('Academic year', esc(p.academic_year))}${row('Amount received', `<b style="font-size:15px">${kes(p.amount)}</b>`)}${row('Paid by', `${esc(p.method.toUpperCase())}${p.reference ? ' · ' + esc(p.reference) : ''}`)}${p.note ? row('Note', esc(p.note)) : ''}</table>
    <table style="margin-top:8px">${row('Total fees for the year', kes(d.charged))}${row('Paid to date (including this)', kes(d.paidToDate))}${row('Balance', `<b>${kes(d.balanceAfter)}</b>`)}</table>
    <div class="ln" style="margin-top:22px">Received by: ${p.received_by ? `<b>${esc(p.received_by)}</b>` : p.method === 'mpesa' && !p.reversed_at ? '<b>M-Pesa (automatic)</b>' : '<span class="bl"></span>'} &nbsp; Signature &amp; stamp: <span class="bl"></span></div></div>`;
}
// A student's fee statement: charges by term, payments, balance, and how to pay. Works for the school and for parents.
export function statementHtml(d) {
  const s = d.school, st = d.student, row = (a, b) => `<tr><td style="width:36%"><b>${a}</b></td><td>${b}</td></tr>`;
  const lines = d.lines || d.items.map((i) => ({ ...i, paid: 0, waived: 0, balance: i.amount })), hasW = d.waived > 0;
  const terms = [...new Set(lines.map((i) => i.term || 'Whole year'))], span = hasW ? 6 : 5;
  const num = (n) => `<td style="text-align:right">${kes(n)}</td>`;
  const charges = terms.map((t) => `<tr><td colspan="${span}" style="background:#f1f2f8"><b>${esc(t)}</b></td></tr>${lines.filter((i) => (i.term || 'Whole year') === t).map((i) => `<tr><td>${esc(i.name)}${i.vote_head && i.vote_head !== i.name ? ` <span class="sm">(${esc(i.vote_head)})</span>` : ''}${i.note ? `<div class="sm">${esc(i.note)}</div>` : ''}</td><td>${i.due_date ? esc(fmtDate(i.due_date)) : ''}</td>${num(i.amount)}${hasW ? num(i.waived || 0) : ''}${num(i.paid)}${num(i.balance)}</tr>`).join('')}`).join('');
  const pays = d.payments.map((p) => `<tr${p.reversed_at ? ' style="text-decoration:line-through;color:#888"' : ''}><td>${esc(p.receipt_no)}${p.reversed_at ? ' (reversed)' : ''}</td><td>${esc(fmtDate(p.paid_on))}</td><td style="text-align:right">${kes(p.amount)}</td></tr>`).join('');
  const KIND = { waiver: 'Waiver', bursary: 'Bursary', discount: 'Discount', sibling: 'Sibling discount', staff_child: 'Staff child discount', other: 'Reduction' };
  const adjs = (d.adjustments || []).filter((a) => a.status === 'approved').map((a) => `<tr><td>${esc(KIND[a.kind] || a.kind)}${a.sponsor ? ` (${esc(a.sponsor)})` : ''}</td><td>${esc(a.reason || '')}</td><td style="text-align:right">${kes(a.amount)}</td></tr>`).join('');
  return `<div class="rcpt">${s.logo_url ? `<img class="logo" src="${esc(s.logo_url)}" alt="">` : ''}<h2>${esc(s.name)}</h2>${s.motto ? `<div class="mo">${esc(s.motto)}</div>` : ''}
    <div class="ti">FEE STATEMENT ${esc(d.year)}</div>
    <table>${row('Student', `${esc(st.full_name)} <span class="sm">(Adm ${esc(st.school_id_number)}${st.class_name ? ', ' + esc(st.class_name) : ''})</span>`)}</table>
    <table style="margin-top:8px"><tr><td><b>Charges</b></td><td><b>Due</b></td><td style="text-align:right"><b>Amount</b></td>${hasW ? '<td style="text-align:right"><b>Waived</b></td>' : ''}<td style="text-align:right"><b>Paid</b></td><td style="text-align:right"><b>Balance</b></td></tr>${charges || `<tr><td colspan="${span}">No charges yet.</td></tr>`}</table>
    <p class="sm" style="margin:4px 0 0">Reductions, then payments, are applied to the oldest charges first.</p>
    ${adjs ? `<table style="margin-top:8px"><tr><td><b>Reductions</b></td><td><b>Reason</b></td><td style="text-align:right"><b>Amount</b></td></tr>${adjs}</table>` : ''}
    ${pays ? `<table style="margin-top:8px"><tr><td><b>Payments</b></td><td><b>Date</b></td><td style="text-align:right"><b>Amount</b></td></tr>${pays}</table>` : ''}
    <table style="margin-top:8px">${row('Total charged', kes(d.charged))}${hasW ? row('Waived or reduced', kes(d.waived)) : ''}${row('Total paid', kes(d.paidGross ?? d.paid))}${d.refunded > 0 ? row('Refunded', kes(d.refunded)) : ''}${row(d.balance < 0 ? 'Credit (overpaid)' : 'Balance', `<b>${kes(Math.abs(d.balance))}</b>`)}</table>
    ${d.instructions ? `<p style="margin-top:12px"><b>How to pay</b><br><span style="white-space:pre-line">${esc(d.instructions)}</span></p>` : ''}</div>`;
}
export async function printStatement(studentId, year) { printHtml(statementHtml(await api(`/fees/statement/${studentId}?year=${year}`))); }
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
      <div class="tabs">${[['overview', 'Overview'], ['pay', 'Record a payment'], ['items', 'Charges'], ['bal', 'Balances'], ['adj', 'Waivers & refunds'], ['def', 'Defaulters'], ['cash', 'Cash-up'], ...(ctx.features.mpesa === true ? [['mpesa', 'M-Pesa']] : [])].map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div><div id="pane"></div>`;
    $$('.tab', el).forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    $('#yr', el).onchange = (e) => { year = e.target.value; draw(); };
    ({ overview, pay, items, bal, adj, def, cash, mpesa })[tab]($('#pane', el)).catch((e) => toast(e.message, 'bad'));
  };

  async function overview(p) {
    const [b, rep, today] = await Promise.all([api(`/fees/balances?year=${year}`), api(`/fees/report?year=${year}`).catch(() => null), api('/fees/cashup').catch(() => null)]), s = b.summary;
    if (!s.charged && !s.collected) { p.innerHTML = '<div class="card empty">No fees set up for this year yet.<br>Add your charges first (the Charges tab), then record payments as they come in.</div>'; return; }
    const owing = b.rows.filter((r) => r.balance > 0).sort((x, y) => y.balance - x.balance).slice(0, 10);
    p.innerHTML = `<div class="grid g4">${stat('Total charged', kes(s.charged), { tone: 'navy' })}${stat('Collected', kes(s.collected), { tone: 'green' })}${stat('Outstanding', kes(s.outstanding), { tone: 'red', sub: `${s.studentsOwing} of ${s.students} students owe` })}${today && today.payments.length ? stat('Collected today', kes(today.total), { tone: 'green', sub: `${today.payments.length} payment${today.payments.length === 1 ? '' : 's'}` }) : ''}${s.waived > 0 ? stat('Waived or reduced', kes(s.waived), { tone: 'navy', sub: 'bursaries and discounts' }) : ''}${s.credits > 0 ? stat('Credits (overpaid)', kes(s.credits), { tone: 'navy', sub: `${s.studentsInCredit} student${s.studentsInCredit === 1 ? '' : 's'}` }) : ''}${stat('Collection rate', s.collectionRate == null ? '—' : num(s.collectionRate) + '%', { tone: 'gold' })}</div>
      <div class="grid g2" style="margin-top:16px"><div class="card"><h2 style="margin-bottom:10px">Collected vs outstanding</h2>${donut([{ label: 'Collected', value: Math.round(s.collected) }, { label: 'Outstanding', value: Math.round(s.outstanding) }].filter((x) => x.value), { center: s.collectionRate == null ? '' : num(s.collectionRate) + '%', title: 'Fees collected versus outstanding' })}</div>
        <div class="card"><h2 style="margin-bottom:10px">Collection rate by class</h2>${hbarChart(s.byClass.filter((c) => c.rate != null).map((c) => ({ label: c.class_name, value: c.rate })), { max: 100, unit: '%', title: 'Collection rate by class', colorFn: (it) => (it.value >= 85 ? 'var(--c3)' : it.value >= 60 ? 'var(--c2)' : 'var(--c5)') })}</div></div>
      ${rep && rep.byVoteHead.length ? `<div class="grid g2" style="margin-top:16px">${[['By vote head', rep.byVoteHead], ['By term', rep.byTerm]].map(([t, rows]) => `<div class="card pad0"><div class="card-h">${t}</div>${table([t === 'By term' ? 'Term' : 'Vote head', 'Charged', 'Paid', 'Owed'], rows.map((r) => [`<b>${esc(r.key)}</b>`, kes(r.charged), kes(r.paid), r.balance > 0 ? `<b style="color:var(--bad)">${kes(r.balance)}</b>` : kes(0)]))}</div>`).join('')}</div><p class="sm mut" style="margin:6px 0 0">Each student's payments go to their oldest charges first (whole-year charges, then Term 1, 2 and 3).</p>` : ''}
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
      <div class="card pad0" style="margin-top:18px"><div class="card-h">Recent payments</div>${table(['Receipt', 'Student', 'Amount', 'Paid by', 'Date', ''], recent.map((r) => [`<b>${esc(r.receipt_no)}</b>`, `${esc(r.full_name)} <span class="mut sm">${esc(r.school_id_number)}</span>`, `<b>${kes(r.amount)}</b>`, esc(r.method.toUpperCase()) + (r.reference ? ` <span class="mut sm">${esc(r.reference)}</span>` : ''), fmtDate(r.paid_on), `<div class="row" style="gap:6px"><button class="btn sm" data-rc="${r.id}">Receipt</button>${r.reversed_at ? '' : `<button class="btn sm danger" data-vd="${r.id}">Reverse</button>`}</div>`]).map((cells, i) => (recent[i].reversed_at ? cells.map((c, j) => (j === 2 ? `<s class="mut">${recent[i].amount.toLocaleString('en-KE')}</s> ${pill('Reversed', 'bad')}` : c)) : cells)), { empty: 'No payments recorded yet.' })}</div>`;
    let owes = null;   // the chosen student's balance, so an overpayment can be flagged
    const show = () => { $('#who', p).innerHTML = chosen ? `Paying for <b>${esc(chosen.full_name)}</b> <span class="mut">(Adm ${esc(chosen.school_id_number)})</span>${owes == null ? '' : ` · ${owes > 0 ? `balance <b>${kes(owes)}</b>` : owes < 0 ? `<b>credit of ${kes(-owes)}</b>` : 'nothing owing'}`}` : '<span class="mut">Choose a student above.</span>'; $('#rec', p).disabled = !chosen; };
    $('#q', p).oninput = (e) => {
      const q = e.target.value.trim().toLowerCase(); chosen = null; owes = null; show();
      const hits = q.length < 2 ? [] : students.filter((s) => `${s.full_name} ${s.school_id_number}`.toLowerCase().includes(q)).slice(0, 8);
      $('#hits', p).innerHTML = hits.map((s) => `<button type="button" class="btn sm" style="margin:0 6px 6px 0" data-pick="${s.id}">${esc(s.full_name)} · ${esc(s.school_id_number)}</button>`).join('') || (q.length >= 2 ? '<span class="mut sm">No match.</span>' : '');
      $$('[data-pick]', p).forEach((b) => (b.onclick = () => { chosen = students.find((s) => s.id === b.dataset.pick); $('#q', p).value = chosen.full_name; $('#hits', p).innerHTML = ''; owes = null; show(); api(`/fees/statement/${chosen.id}?year=${year}`).then((d) => { owes = d.balance; show(); }).catch(() => {}); }));
    };
    show();
    $('#rec', p).onclick = (e) => run(e.currentTarget, async () => {
      const amt = Number(String($('#amt', p).value).replace(/[, ]/g, ''));
      if (owes != null && amt > owes && !(await confirmBox(owes > 0 ? `This is more than the balance of ${kes(owes)}. The extra ${kes(amt - owes)} will show as a credit for ${chosen.full_name}.` : `${chosen.full_name} has nothing owing. This whole payment will show as a credit.`, 'Record it'))) return;
      const body = { studentId: chosen.id, amount: $('#amt', p).value, method: $('#mth', p).value, reference: $('#ref', p).value, paidOn: $('#dt', p).value, academicYear: year, note: $('#note', p).value };
      let r;
      try { r = await api('/fees/payments', { method: 'POST', body }); }
      catch (err) {
        if (err.status !== 409) throw err;   // the same M-Pesa code was already recorded: ask before recording it again
        if (!(await confirmBox(`${err.message} Record it again anyway?`, 'Record again'))) return;
        r = await api('/fees/payments', { method: 'POST', body: { ...body, allowDuplicate: true } });
      }
      toast(`Recorded ${kes(r.amount)}, receipt ${r.receipt_no}`, 'ok');
      modal(`<h3>Payment recorded</h3><p>${kes(r.amount)} from <b>${esc(chosen.full_name)}</b>.<br>Receipt number <span class="secret">${esc(r.receipt_no)}</span></p><div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-close>Close</button><button class="btn primary" id="pr">Print receipt</button></div>`, { onMount: (m) => { $('#pr', m).onclick = () => printReceipt(r.id).catch((x) => toast(x.message, 'bad')); } });
      pay(p);
    });
    $$('[data-rc]', p).forEach((b) => (b.onclick = () => run(b, () => printReceipt(b.dataset.rc))));
    // Reversing keeps the record (who, when, why) and stops the payment counting. A finance officer's request goes to the principal.
    $$('[data-vd]', p).forEach((b) => (b.onclick = () => modal(`<h3>Reverse this payment</h3><p class="sm mut">The payment stays on record, marked as reversed, and no longer counts towards the balance. If you are the finance officer, the principal approves it first.</p>
      <label class="f" for="why" style="margin-top:12px">Why is it being reversed? *</label><input class="i" id="why" maxlength="200" placeholder="e.g. Recorded against the wrong student">
      <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn danger" id="go">Reverse payment</button></div>`, {
      onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => { const r = await api(`/fees/payments/${b.dataset.vd}/reverse`, { method: 'POST', body: { reason: $('#why', m).value } }); close(); toast(r?.pendingApproval ? r.message : 'Payment reversed', 'ok'); pay(p); }); } })));
  }

  // ---- charges: the fee structure ----
  const AUD = { all: 'Everyone', day: 'Day scholars only', boarding: 'Boarders only', optional: 'Chosen students only' };
  const HEADS = ['Tuition', 'Boarding', 'Transport', 'Lunch', 'Water', 'Activity', 'Exams', 'Uniform', 'Trip', 'Development', 'Other'];
  const appliesTo = (x) => [x.audience === 'all' ? '' : AUD[x.audience], x.grades?.length ? x.grades.join(', ') : (x.grade || '')].filter(Boolean).join(' · ') || 'Everyone';
  const itemForm = (x = {}) => `<div class="form-grid">
      <div><label class="f" for="nm">Name *</label><input class="i" id="nm" value="${esc(x.name || '')}" placeholder="Tuition"></div>
      <div><label class="f" for="am">Amount (KSh) *</label><input class="i" id="am" inputmode="decimal" value="${x.amount ?? ''}"></div>
      <div><label class="f" for="vh">Vote head</label><input class="i" id="vh" list="heads" value="${esc(x.vote_head || '')}" placeholder="e.g. Tuition"><datalist id="heads">${HEADS.map((h) => `<option value="${h}">`).join('')}</datalist></div>
      <div><label class="f" for="tm">Term</label><select class="i" id="tm"><option value="">Whole year</option>${['Term 1', 'Term 2', 'Term 3'].map((t) => `<option ${x.term === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div><label class="f" for="au">Who pays it</label><select class="i" id="au">${Object.entries(AUD).map(([k, v]) => `<option value="${k}" ${(x.audience || 'all') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div><label class="f" for="dd">Due date</label><input class="i" id="dd" type="date" value="${esc(x.due_date || '')}"></div>
      <div style="grid-column:1/-1"><span class="f">Grades that pay this (leave all unticked for every grade)</span><div class="row" style="flex-wrap:wrap;gap:6px 14px;margin-top:4px">${grades.map((g) => `<label class="row" style="gap:5px"><input type="checkbox" data-g="${esc(g)}" ${x.grades?.includes(g) ? 'checked' : ''}> ${esc(g)}</label>`).join('') || '<span class="mut sm">Add classes first.</span>'}</div></div>
      <div style="grid-column:1/-1"><label class="f" for="nt">Note for parents (optional)</label><input class="i" id="nt" maxlength="300" value="${esc(x.note || '')}" placeholder="e.g. Trip to Naivasha, pay by 20 Nov"></div></div>`;
  const readItemForm = (r) => ({ name: $('#nm', r).value, amount: $('#am', r).value, voteHead: $('#vh', r).value, term: $('#tm', r).value || null, audience: $('#au', r).value, dueDate: $('#dd', r).value, note: $('#nt', r).value, grades: $$('[data-g]:checked', r).map((c) => c.dataset.g) });

  // Pick a class, tick students, save. Used for "who takes this optional charge" and "who boards".
  function classPicker({ title, intro, tick, load, save }) {
    modal(`<h3>${esc(title)}</h3><p class="sm mut">${esc(intro)}</p>
      <select class="i" id="cl"><option value="">Choose a class…</option>${classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <div id="lst" style="margin-top:10px;max-height:300px;overflow:auto"></div>
      <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-close>Close</button><button class="btn primary" id="sv" disabled>Save</button></div>`, {
      onMount: (m) => {
        let cls = '';
        $('#cl', m).onchange = async (e) => {
          cls = e.target.value; $('#sv', m).disabled = !cls; if (!cls) { $('#lst', m).innerHTML = ''; return; }
          const rows = await load(cls);
          $('#lst', m).innerHTML = rows.map((s) => `<label class="row" style="gap:8px;padding:3px 0"><input type="checkbox" data-s="${s.id}" ${tick(s) ? 'checked' : ''}> ${esc(s.full_name)} <span class="mut sm">${esc(s.school_id_number)}</span></label>`).join('') || '<span class="mut">No students in this class.</span>';
        };
        $('#sv', m).onclick = (e) => run(e.currentTarget, async () => { await save(cls, $$('[data-s]:checked', m).map((c) => c.dataset.s)); toast('Saved', 'ok'); });
      } });
  }

  async function items(p) {
    const it = await api(`/fees/items?year=${year}`), drafts = it.items.filter((x) => !x.published_at);
    p.innerHTML = `${drafts.length ? `<div class="card" style="border-color:var(--warn);margin-bottom:16px"><div class="row" style="justify-content:space-between;gap:12px;flex-wrap:wrap"><div><b>${drafts.length} draft charge${drafts.length === 1 ? '' : 's'}</b><div class="sm mut">Drafts are not billed and parents cannot see them. Publish when the fee structure is ready.</div></div><button class="btn primary" id="pub">Publish ${drafts.length} charge${drafts.length === 1 ? '' : 's'}</button></div></div>` : ''}
      <div class="card"><h2 style="margin-bottom:12px">Add a charge for ${esc(year)}</h2>${itemForm()}
        <p class="sm mut" style="margin-top:10px">A new charge starts as a draft. A student's balance for the year is every published charge that applies to them, minus what they have paid.</p><button class="btn primary" id="add">Save as draft</button></div>
      <div class="card pad0" style="margin-top:18px">${table(['Charge', 'Applies to', 'Term', 'Due', 'Amount', 'Status', ''], it.items.map((x) => [
        `<b>${esc(x.name)}</b>${x.vote_head ? ` <span class="mut sm">· ${esc(x.vote_head)}</span>` : ''}${x.note ? `<div class="sm mut">${esc(x.note)}</div>` : ''}`,
        `${esc(appliesTo(x))}${x.audience === 'optional' ? `<div class="sm mut">${x.assigned} student${x.assigned === 1 ? '' : 's'}</div>` : ''}`, esc(x.term || 'Whole year'), x.due_date ? esc(fmtDate(x.due_date)) : '—', kes(x.amount),
        x.published_at ? pill('Published', 'ok') : pill('Draft', 'warn'),
        `<div class="row" style="gap:6px">${x.published_at ? '' : `<button class="btn sm" data-edit="${x.id}">Edit</button>`}${x.audience === 'optional' ? `<button class="btn sm" data-asg="${x.id}">Students</button>` : ''}<button class="btn sm danger" data-del="${x.id}">Delete</button></div>`]), { empty: `No charges for ${year} yet.` })}</div>
      <div class="grid g2" style="margin-top:18px"><div class="card"><h2 style="margin-bottom:6px">Day scholars and boarders</h2><p class="sm mut">Some charges (boarding, for example) apply to boarders only. Mark who boards, class by class.</p><button class="btn" id="brd">Set boarders</button></div>
        <div class="card"><h2 style="margin-bottom:6px">How parents pay</h2><textarea class="i" id="ins" rows="3" maxlength="600" placeholder="e.g. M-Pesa Paybill 123456, account number = your child's admission number">${esc(it.instructions || '')}</textarea><button class="btn" id="sins" style="margin-top:8px">Save instructions</button></div></div>`;
    const said = (r, ok) => toast(r?.pendingApproval ? r.message : ok, 'ok');
    $('#add', p).onclick = (e) => run(e.currentTarget, async () => {
      const f = readItemForm(p); if (!f.name.trim()) return toast('Give the charge a name.', 'bad');
      await api('/fees/items', { method: 'POST', body: { ...f, academicYear: year } }); toast('Saved as a draft. Publish when the structure is ready.', 'ok'); items(p);
    });
    $('#pub', p)?.addEventListener('click', async (e) => { if (await confirmBox(`Publish ${drafts.length} charge${drafts.length === 1 ? '' : 's'} for ${year}? They start counting in balances and parents can see them.`, 'Publish')) run(e.target, async () => { said(await api('/fees/items/publish', { method: 'POST', body: { year } }), 'Published'); items(p); }); });
    $$('[data-edit]', p).forEach((b) => (b.onclick = () => {
      const x = it.items.find((i) => i.id === b.dataset.edit);
      modal(`<h3>Edit draft charge</h3>${itemForm(x)}<div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="sv">Save</button></div>`, {
        onMount: (m, close) => { $('#sv', m).onclick = (e) => run(e.currentTarget, async () => { await api(`/fees/items/${x.id}`, { method: 'PATCH', body: readItemForm(m) }); close(); toast('Saved', 'ok'); items(p); }); } });
    }));
    $$('[data-asg]', p).forEach((b) => (b.onclick = () => {
      const x = it.items.find((i) => i.id === b.dataset.asg);
      classPicker({ title: `Students taking "${x.name}"`, intro: 'Choose a class, then tick the students who take it.', tick: (s) => s.assigned, load: (c) => api(`/fees/items/${x.id}/assignments?classId=${c}`), save: (c, ids) => api(`/fees/items/${x.id}/assignments`, { method: 'PUT', body: { classId: c, studentIds: ids } }).then(() => items(p)) });
    }));
    $$('[data-del]', p).forEach((b) => (b.onclick = async () => { if (await confirmBox('Delete this charge? Balances change straight away. A finance officer needs the principal to approve deleting a published charge.', 'Delete')) run(b, async () => { said(await api(`/fees/items/${b.dataset.del}`, { method: 'DELETE' }), 'Deleted'); items(p); }); }));
    $('#brd', p).onclick = () => classPicker({ title: 'Who boards?', intro: 'Choose a class and tick the boarders. Everyone else in the class is a day scholar.', tick: (s) => s.boarding === 'boarding', load: (c) => api(`/fees/boarding?classId=${c}`), save: (c, ids) => api('/fees/boarding', { method: 'PUT', body: { classId: c, boardingIds: ids } }) });
    $('#sins', p).onclick = (e) => run(e.currentTarget, async () => { await api('/fees/instructions', { method: 'PATCH', body: { text: $('#ins', p).value } }); toast('Saved. Parents see this on their fees page.', 'ok'); });
  }

  // A name search that picks one student. onPick gets the student, or null while typing.
  const studentSearch = (m, list, onPick) => {
    const find = () => {
      const q = $('#q', m).value.toLowerCase().trim();
      $('#hits', m).innerHTML = q.length < 2 ? '' : list.filter((s) => (s.full_name + ' ' + s.school_id_number).toLowerCase().includes(q)).slice(0, 6).map((s) => `<button class="btn sm" style="margin:0 6px 6px 0" data-pk="${s.id}">${esc(s.full_name)} <span class="mut">${esc(s.school_id_number)}</span></button>`).join('');
      $$('[data-pk]', m).forEach((x) => (x.onclick = () => { const s = list.find((z) => z.id === x.dataset.pk); $('#q', m).value = s.full_name; $('#hits', m).innerHTML = ''; onPick(s); }));
    };
    $('#q', m).oninput = () => { onPick(null); find(); };
  };

  // ---- waivers, bursaries, discounts and refunds ----
  async function adj(p) {
    const [ads, refs, students] = await Promise.all([api(`/fees/adjustments?year=${year}`), api(`/fees/refunds?year=${year}`), api('/students').catch(() => [])]);
    const ST = { pending: ['Waiting for approval', 'warn'], approved: ['Approved', 'ok'], rejected: ['Rejected', 'bad'], cancelled: ['Cancelled', ''] };
    const KIND = { waiver: 'Waiver', bursary: 'Bursary', discount: 'Discount', sibling: 'Sibling discount', staff_child: 'Staff child', other: 'Other' };
    p.innerHTML = `<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:14px"><button class="btn primary" id="aw">+ Waiver, bursary or discount</button><button class="btn" id="ar">+ Refund</button></div>
      <h2 style="margin-bottom:8px">Waivers, bursaries and discounts</h2>
      <div class="card pad0">${table(['Student', 'Kind', 'Amount', 'Why', 'Status'], ads.map((a) => [`<b>${esc(a.full_name)}</b><div class="sm mut">${esc(a.school_id_number)}</div>`, `${esc(KIND[a.kind] || a.kind)}${a.sponsor ? `<div class="sm mut">${esc(a.sponsor)}</div>` : ''}`, kes(a.amount), esc(a.reason), pill(...ST[a.status])]), { empty: `No waivers or bursaries for ${year}.` })}</div>
      <h2 style="margin:20px 0 8px">Refunds</h2>
      <div class="card pad0">${table(['Student', 'Amount', 'How', 'Why', 'Date', 'Status'], refs.map((r) => [`<b>${esc(r.full_name)}</b><div class="sm mut">${esc(r.school_id_number)}</div>`, kes(r.amount), esc(r.method), esc(r.reason), esc(fmtDate(r.refunded_on)), pill(...ST[r.status])]), { empty: `No refunds for ${year}.` })}</div>
      <p class="sm mut" style="margin-top:10px">A waiver reduces what a student owes. A refund returns money a student has paid beyond what they owe. To refund a student who left, first reduce their remaining charges with a waiver. If you are the finance officer, the principal approves both.</p>`;
    const done = (r, ok) => { toast(r?.pendingApproval ? r.message : ok, 'ok'); adj(p); };
    $('#aw', p).onclick = () => {
      let pick = null;
      modal(`<h3>Waiver, bursary or discount</h3><label class="f" for="q" style="margin-top:10px">Student</label><input class="i" id="q" placeholder="Type a name or admission number" autocomplete="off"><div id="hits" style="margin-top:6px"></div><p class="sm mut" id="info"></p>
        <div class="form-grid"><div><label class="f" for="kd">Kind</label><select class="i" id="kd">${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div><label class="f" for="am">Amount (KSh)</label><input class="i" id="am" inputmode="decimal"></div></div>
        <label class="f" for="sp" style="margin-top:10px">Sponsor (for bursaries, optional)</label><input class="i" id="sp" maxlength="80" placeholder="e.g. CDF, a church, a company">
        <label class="f" for="rs" style="margin-top:10px">Why? *</label><input class="i" id="rs" maxlength="200">
        <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go" disabled>Save</button></div>`, {
        onMount: (m, close) => {
          studentSearch(m, students, async (s) => { pick = s; $('#go', m).disabled = !s; $('#info', m).textContent = ''; if (s) { const d = await api(`/fees/statement/${s.id}?year=${year}`).catch(() => null); if (d && pick === s) $('#info', m).textContent = `Charged ${kes(d.charged)}, already reduced ${kes(d.waived)}.`; } });
          $('#go', m).onclick = (e) => run(e.currentTarget, async () => { done(await api('/fees/adjustments', { method: 'POST', body: { studentId: pick.id, kind: $('#kd', m).value, amount: $('#am', m).value, sponsor: $('#sp', m).value, reason: $('#rs', m).value, academicYear: year } }), 'Saved'); close(); });
        } });
    };
    $('#ar', p).onclick = () => {
      let pick = null;
      modal(`<h3>Refund</h3><label class="f" for="q" style="margin-top:10px">Student</label><input class="i" id="q" placeholder="Type a name or admission number" autocomplete="off"><div id="hits" style="margin-top:6px"></div><p class="sm mut" id="info"></p>
        <div class="form-grid"><div><label class="f" for="am">Amount (KSh)</label><input class="i" id="am" inputmode="decimal"></div><div><label class="f" for="mt">How is it returned?</label><select class="i" id="mt">${['cash', 'mpesa', 'bank', 'cheque', 'other'].map((x) => `<option value="${x}">${x === 'mpesa' ? 'M-Pesa' : x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select></div></div>
        <label class="f" for="rf" style="margin-top:10px">Reference (optional)</label><input class="i" id="rf" maxlength="60">
        <label class="f" for="rs" style="margin-top:10px">Why? *</label><input class="i" id="rs" maxlength="200">
        <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go" disabled>Save</button></div>`, {
        onMount: (m, close) => {
          studentSearch(m, students, async (s) => { pick = s; $('#go', m).disabled = !s; $('#info', m).textContent = ''; if (s) { const d = await api(`/fees/statement/${s.id}?year=${year}`).catch(() => null); if (d && pick === s) { $('#info', m).textContent = d.credit > 0 ? `Credit that can be refunded: ${kes(d.credit)}.` : 'No credit to refund: nothing has been paid beyond what is owed.'; if (d.credit > 0 && !$('#am', m).value) $('#am', m).value = d.credit; } } });
          $('#go', m).onclick = (e) => run(e.currentTarget, async () => { done(await api('/fees/refunds', { method: 'POST', body: { studentId: pick.id, amount: $('#am', m).value, method: $('#mt', m).value, reference: $('#rf', m).value, reason: $('#rs', m).value, academicYear: year } }), 'Refund recorded'); close(); });
        } });
    };
  }

  // ---- who owes, and for how long ----
  async function def(p) {
    let classId = '', d;
    const draw = async () => {
      d = await api(`/fees/defaulters?year=${year}${classId ? `&classId=${classId}` : ''}`);
      const a = d.ageing;
      $('#dres', p).innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">${stat('Not yet due', kes(a.notDue), { tone: 'navy' })}${stat('1 to 30 days late', kes(a.d1_30), { tone: 'gold' })}${stat('31 to 60 days', kes(a.d31_60), { tone: 'gold' })}${stat('61 to 90 days', kes(a.d61_90), { tone: 'red' })}${stat('Over 90 days', kes(a.d90plus), { tone: 'red' })}</div>
        <p class="sm mut" style="margin:10px 0">${d.students} student${d.students === 1 ? '' : 's'} owe ${kes(d.total)} in total. A charge counts as late once its due date has passed; charges with no due date are shown as not yet due.</p>
        <div class="card pad0">${table(['Student', 'Class', 'Parent phone', 'Owes', 'Overdue', 'Oldest due', ''], d.rows.map((r) => [`<b>${esc(r.full_name)}</b><div class="sm mut">${esc(r.school_id_number)}</div>`, esc(r.class_name || '—'), r.parent_phone ? `<a href="tel:${esc(String(r.parent_phone).replace(/[^\d+]/g, ''))}">${esc(r.parent_phone)}</a>` : '—', `<b>${kes(r.balance)}</b>`, r.overdue > 0 ? `<b style="color:var(--bad)">${kes(r.overdue)}</b>` : '—', r.oldest_due ? `${esc(fmtDate(r.oldest_due))}<div class="sm mut">${r.days_overdue} days</div>` : '—', `<button class="btn sm" data-stm="${r.student_id}">Statement</button>`]), { empty: 'Nobody owes anything for this selection.' })}</div>`;
      $$('[data-stm]', p).forEach((b) => (b.onclick = () => run(b, () => printStatement(b.dataset.stm, year))));
    };
    p.innerHTML = `<div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:14px;align-items:end"><div><label class="f" for="cf">Class</label><select class="i" id="cf"><option value="">All classes</option>${classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div><button class="btn" id="csv">Download list (CSV)</button></div><div id="dres"></div>`;
    $('#cf', p).onchange = (e) => { classId = e.target.value; draw(); };
    $('#csv', p).onclick = () => {
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = ['Student,Admission no,Class,Parent phone,Owes,Overdue,Oldest due,Days overdue', ...d.rows.map((r) => [r.full_name, r.school_id_number, r.class_name, r.parent_phone, r.balance, r.overdue, r.oldest_due, r.days_overdue].map(q).join(','))].join('\n');
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `defaulters-${year}.csv` }); a.click(); URL.revokeObjectURL(a.href);
    };
    await draw();
  }

  // ---- the day's takings, for cashing up ----
  async function cash(p) {
    let date = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10), d;
    const METHOD = { cash: 'Cash', mpesa: 'M-Pesa', bank: 'Bank', cheque: 'Cheque', other: 'Other' };
    const draw = async () => {
      d = await api(`/fees/cashup?date=${date}`);
      $('#cres', p).innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">${d.byMethod.map((m) => stat(METHOD[m.method] || m.method, kes(m.total), { sub: `${m.count} payment${m.count === 1 ? '' : 's'}` })).join('')}${stat('Total received', kes(d.total), { tone: 'green' })}${d.refunded > 0 ? stat('Refunded', kes(d.refunded), { tone: 'red' }) : ''}${d.refunded > 0 ? stat('Net', kes(d.net), { tone: 'navy' }) : ''}</div>
        <div class="card pad0" style="margin-top:14px">${table(['Receipt', 'Student', 'Method', 'Reference', 'Amount', 'Recorded by'], d.payments.map((x) => [esc(x.receipt_no), `<b>${esc(x.full_name)}</b>`, esc(METHOD[x.method] || x.method), esc(x.reference || '—'), kes(x.amount), esc(x.recorded_by || 'M-Pesa (automatic)')]), { empty: 'No payments recorded for this day.' })}</div>
        ${d.reversed.length ? `<p class="sm" style="margin:10px 0 0"><b>Reversed on this day (not counted):</b> ${d.reversed.map((x) => `${esc(x.receipt_no)} ${kes(x.amount)} (${esc(x.full_name)}: ${esc(x.reversal_reason || '')})`).join('; ')}</p>` : ''}`;
    };
    p.innerHTML = `<div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:14px;align-items:end"><div><label class="f" for="cd">Date</label><input class="i" id="cd" type="date" value="${date}"></div><button class="btn" id="pr">Print</button></div><div id="cres"></div>`;
    $('#cd', p).onchange = (e) => { date = e.target.value || date; draw(); };
    $('#pr', p).onclick = () => printHtml(`<div class="rcpt"><h2>Daily cash-up</h2><div class="ti">${esc(fmtDate(date))}</div><table>${d.byMethod.map((m) => `<tr><td>${esc(METHOD[m.method] || m.method)} (${m.count})</td><td style="text-align:right">${kes(m.total)}</td></tr>`).join('')}<tr><td><b>Total received</b></td><td style="text-align:right"><b>${kes(d.total)}</b></td></tr>${d.refunded > 0 ? `<tr><td>Refunded</td><td style="text-align:right">${kes(d.refunded)}</td></tr><tr><td><b>Net</b></td><td style="text-align:right"><b>${kes(d.net)}</b></td></tr>` : ''}</table><table style="margin-top:10px">${d.payments.map((x) => `<tr><td>${esc(x.receipt_no)}</td><td>${esc(x.full_name)}</td><td>${esc(METHOD[x.method] || x.method)}</td><td style="text-align:right">${kes(x.amount)}</td></tr>`).join('')}</table><p class="ln" style="margin-top:22px">Counted by: <span class="bl"></span> &nbsp; Signed: <span class="bl"></span></p></div>`);
    await draw();
  }

  // ---- M-Pesa: the school's own Paybill, payments that need a decision, and recent M-Pesa payments ----
  const MP = { paid: ['Recorded', 'ok'], pending: ['Waiting', 'warn'], unmatched: ['Needs a student', 'bad'], claimed: ['Parent says paid', 'warn'], failed: ['Failed', 'bad'], cancelled: ['Cancelled', ''], ignored: ['Set aside', ''], rejected: ['Rejected', ''] };
  async function mpesa(p) {
    let cfg;
    try { cfg = await api('/mpesa/settings'); } catch (e) { p.innerHTML = `<div class="card"><p class="mut" style="margin:0">Only the principal or the finance officer can set up M-Pesa.</p></div>`; return; }
    const [queue, recent, students] = await Promise.all([api('/mpesa/transactions'), api('/mpesa/transactions?view=recent'), api('/students').catch(() => [])]), s = cfg.settings;
    const when = (t) => new Date(t).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const secret = (has) => `type="password" autocomplete="new-password" placeholder="${has ? 'Saved. Leave empty to keep it' : ''}"`;
    p.innerHTML = `${cfg.secretsReady ? '' : '<div class="notice" style="margin-bottom:14px">The server is not set up to store keys yet. Ask Acalyze support to add the MPESA_SECRET_KEY setting.</div>'}
      <div class="card"><h2 style="margin-bottom:6px">Your Paybill</h2><p class="sm mut">Parents pay straight into your own Paybill. Acalyze never holds your money. Get the keys from your Safaricom Daraja account.</p>
        <div class="form-grid" style="margin-top:12px">
          <div><label class="f" for="sc">Paybill number</label><input class="i" id="sc" inputmode="numeric" value="${esc(s?.shortcode || '')}"></div>
          <div><label class="f" for="ev">Mode</label><select class="i" id="ev"><option value="sandbox" ${s?.env !== 'production' ? 'selected' : ''}>Test (sandbox)</option><option value="production" ${s?.env === 'production' ? 'selected' : ''}>Live (real money)</option></select></div>
          <div><label class="f" for="ck">Consumer key</label><input class="i" id="ck" ${secret(s?.hasKey)}></div>
          <div><label class="f" for="cs">Consumer secret</label><input class="i" id="cs" ${secret(s?.hasSecret)}></div>
          <div><label class="f" for="pk">Passkey</label><input class="i" id="pk" ${secret(s?.hasPasskey)}></div>
          <div style="display:flex;align-items:end"><label class="row" style="gap:8px"><input type="checkbox" id="en" ${s?.enabled ? 'checked' : ''}> <b>M-Pesa is switched on</b></label></div></div>
        <div class="row" style="gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn primary" id="sv">Save</button><button class="btn" id="ts" ${s ? '' : 'disabled'}>Test my keys</button><button class="btn" id="rg" ${s ? '' : 'disabled'}>Register payment addresses</button></div>
        ${s ? `<p class="sm mut" style="margin:10px 0 0">${s.urlsRegisteredAt ? `Payment addresses registered with Safaricom on ${esc(fmtDate(s.urlsRegisteredAt))}.` : 'Payment addresses are not registered yet. Do this once, after saving and testing, so payments made straight to your Paybill reach Acalyze.'}</p>
          ${s.urls ? `<details style="margin-top:8px"><summary class="sm">Show the addresses</summary><div class="sm" style="margin-top:6px;word-break:break-all">${['stk', 'confirm', 'validate'].map((k) => `<div class="mut">${k}</div><code>${esc(s.urls[k])}</code>`).join('')}</div><button class="btn sm danger" id="rot" style="margin-top:8px">Make new secret addresses</button></details>` : `<p class="sm" style="color:var(--bad)">${cfg.appUrlSet ? '' : 'The server needs the APP_URL setting before it can tell Safaricom where to send payments.'}</p>`}` : ''}</div>
      <h2 style="margin:20px 0 8px">Needs your attention${queue.length ? ` (${queue.length})` : ''}</h2>
      <div class="card pad0">${table(['When', 'Code', 'Amount', 'Details', ''], queue.map((t) => [esc(when(t.created_at)), `<b>${esc(t.trans_id || '—')}</b>`, t.amount != null ? kes(t.amount) : '—',
        `${pill(...MP[t.status])} ${t.source === 'claim' ? `<span class="sm">Parent of ${esc(t.student_name || 'a student')} says they paid.${t.note ? ' ' + esc(t.note) : ''}</span>` : `<span class="sm">Account typed: <b>${esc(t.account_ref || 'nothing')}</b>${t.phone ? ' · ' + esc(t.phone) : ''}</span>`}`,
        `<div class="row" style="gap:6px"><button class="btn sm primary" data-as="${t.id}">Assign</button><button class="btn sm" data-ig="${t.id}">Set aside</button></div>`]), { empty: 'Nothing waiting. Every M-Pesa payment found its student.' })}</div>
      <h2 style="margin:20px 0 8px">Recent M-Pesa payments</h2>
      <div class="card pad0">${table(['When', 'Code', 'Amount', 'Student', 'Status'], recent.map((t) => [esc(when(t.created_at)), esc(t.trans_id || '—'), t.amount != null ? kes(t.amount) : '—', esc(t.student_name || '—'), `${pill(...MP[t.status])}${t.receipt_no ? ` <span class="sm mut">${esc(t.receipt_no)}</span>` : ''}`]), { empty: 'No M-Pesa payments yet.' })}</div>`;
    const sayErr = (e) => toast(e.message, 'bad');
    $('#sv', p).onclick = (e) => run(e.currentTarget, async () => { await api('/mpesa/settings', { method: 'PUT', body: { shortcode: $('#sc', p).value, env: $('#ev', p).value, consumerKey: $('#ck', p).value, consumerSecret: $('#cs', p).value, passkey: $('#pk', p).value, enabled: $('#en', p).checked } }); toast('Saved', 'ok'); mpesa(p); });
    $('#ts', p).onclick = (e) => run(e.currentTarget, async () => { const r = await api('/mpesa/test', { method: 'POST', body: {} }); toast(r.message, 'ok'); });
    $('#rg', p).onclick = (e) => run(e.currentTarget, async () => { await api('/mpesa/register-urls', { method: 'POST', body: {} }); toast('Registered with Safaricom', 'ok'); mpesa(p); });
    $('#rot', p)?.addEventListener('click', async (e) => { if (await confirmBox('Make new secret addresses? The old ones stop working. You must register the payment addresses again afterwards.', 'Make new')) run(e.target, async () => { await api('/mpesa/rotate-token', { method: 'POST', body: {} }); toast('Done. Register the payment addresses again.', 'ok'); mpesa(p); }); });
    $$('[data-as]', p).forEach((b) => (b.onclick = () => {
      const t = queue.find((x) => x.id === b.dataset.as); let pick = t.student_id || null;
      modal(`<h3>Assign this payment</h3><p class="sm mut">${t.amount != null ? kes(t.amount) : 'An amount'} · code ${esc(t.trans_id || '—')}${t.source === 'claim' ? '. Check the code against your M-Pesa statement first.' : `. The parent typed <b>${esc(t.account_ref || 'nothing')}</b>.`}</p>
        <label class="f" for="q">Student</label><input class="i" id="q" placeholder="Type a name or admission number" autocomplete="off" value="${esc(t.student_name || '')}"><div id="hits" style="margin-top:6px"></div>
        <label class="f" for="amt" style="margin-top:12px">Amount received (KSh)</label><input class="i" id="amt" inputmode="decimal" value="${t.amount ?? ''}">
        <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go" ${pick ? '' : 'disabled'}>Record payment</button></div>`, {
        onMount: (m, close) => {
          const find = () => { const q = $('#q', m).value.toLowerCase().trim(); $('#hits', m).innerHTML = q.length < 2 ? '' : students.filter((s) => (s.full_name + ' ' + s.school_id_number).toLowerCase().includes(q)).slice(0, 6).map((s) => `<button class="btn sm" style="margin:0 6px 6px 0" data-pk="${s.id}">${esc(s.full_name)} <span class="mut">${esc(s.school_id_number)}</span></button>`).join('');
            $$('[data-pk]', m).forEach((x) => (x.onclick = () => { pick = x.dataset.pk; $('#q', m).value = students.find((s) => s.id === pick).full_name; $('#hits', m).innerHTML = ''; $('#go', m).disabled = false; })); };
          $('#q', m).oninput = () => { pick = null; $('#go', m).disabled = true; find(); };
          $('#go', m).onclick = (e) => run(e.currentTarget, async () => { const r = await api(`/mpesa/transactions/${t.id}/assign`, { method: 'POST', body: { studentId: pick, amount: $('#amt', m).value } }); close(); toast(`Recorded as receipt ${r.receipt_no}`, 'ok'); mpesa(p); });
        } });
    }));
    $$('[data-ig]', p).forEach((b) => (b.onclick = () => modal(`<h3>Set this payment aside</h3><p class="sm mut">For example, it is not a school fee, or it was refunded. It stays on record.</p><input class="i" id="why" maxlength="200" placeholder="Reason"><div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn danger" id="go">Set aside</button></div>`, {
      onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => { await api(`/mpesa/transactions/${b.dataset.ig}/ignore`, { method: 'POST', body: { reason: $('#why', m).value } }); close(); mpesa(p); }); } })));
  }

  async function bal(p) {
    let cls = '', onlyOwing = false, data = null;
    p.innerHTML = `<div class="row" style="margin-bottom:14px"><select class="i" id="cf" style="width:auto"><option value="">All classes</option>${classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <label class="row" style="gap:6px"><input type="checkbox" id="ow"> Only students who owe</label><span class="grow"></span><button class="btn sm" id="csv">Download CSV</button></div><div id="tb"></div>`;
    const paint = () => { const rows = data.rows.filter((r) => !onlyOwing || r.balance > 0); $('#tb', p).innerHTML = `<div class="card pad0">${table(['Student', 'Adm no.', 'Class', 'Charged', 'Paid', 'Balance', ''], rows.map((r) => [`<b>${esc(r.full_name)}</b>`, esc(r.school_id_number), esc(r.class_name || '—'), kes(r.charged), kes(r.paid), `<b style="color:${r.balance > 0 ? 'var(--bad)' : 'var(--ok)'}">${kes(r.balance)}</b>`, `<button class="btn sm" data-stm="${r.student_id}">Statement</button>`]), { empty: 'No students match.' })}</div>`; $$('[data-stm]', p).forEach((b) => (b.onclick = () => run(b, () => printStatement(b.dataset.stm, year)))); };
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
