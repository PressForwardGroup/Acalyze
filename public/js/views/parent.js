import { api } from '../api.js';
import { esc, $, $$, toast, lineChart, modal, run } from '../ui.js';
import { renderCard, printHtml, cardOptions, termFromExam } from './reportcard.js';
import { messages } from './chat.js';
import * as school from './school.js';
import { printReceipt } from './school.js';
import { stat, kes, num, fmtDate, pill, table } from '../ui.js';

async function results(el, ctx) {
  const [kids, exams] = await Promise.all([api('/students/mine'), api('/exams')]);
  if (!kids.length) { el.innerHTML = `${ctx.bar('Report cards')}<div class="card empty">No children are linked to your account yet.<br>Please contact your child's school.</div>`; return; }
  if (!exams.length) { el.innerHTML = `${ctx.bar('Report cards', kids.map((k) => k.full_name).join(', '))}<div class="card empty">No results have been published yet. Check back soon.</div>`; return; }
  let kid = kids[0].id, exam = exams[0].id;
  el.innerHTML = `${ctx.bar('Report cards', `Hello ${ctx.me.name || ''}`.trim())}
  <div class="card no-print"><div class="form-grid">${kids.length > 1 ? `<div><label class="f" for="kid">Child</label><select class="i" id="kid">${kids.map((k) => `<option value="${k.id}">${esc(k.full_name)} (${esc(k.class_name || 'no class')})</option>`).join('')}</select></div>` : ''}
    <div><label class="f" for="ex">Exam</label><select class="i" id="ex">${exams.map((e) => `<option value="${e.id}">${esc(e.name)}${e.academic_year ? ' · ' + esc(e.academic_year) : ''}</option>`).join('')}</select></div></div>
    <div class="row" style="margin-top:12px"><button class="btn" id="pr">Print or save as PDF</button></div></div>
  <div id="card"><div class="empty">Loading…</div></div><div id="trend"></div><div id="extras" class="fade"></div>`;
  let current = '';
  const load = async () => {
    $('#card', el).innerHTML = '<div class="empty">Loading…</div>'; $('#trend', el).innerHTML = ''; $('#extras', el).innerHTML = '';
    try {
      const [r, trend] = await Promise.all([api(`/report-card/${kid}?examId=${exam}`), api(`/report-card/${kid}/trend`)]);
      const o = { ...cardOptions(), term: termFromExam(r.exam), date: cardOptions().date };
      current = renderCard(r.card, r.exam, o, trend);
      $('#card', el).innerHTML = `<div class="ov">${current}</div>`;
      if (r.card.template === 'classic' && trend.length > 1) $('#trend', el).innerHTML = `<div class="card no-print" style="max-width:860px;margin:16px auto"><h2 style="margin-bottom:8px">Progress across exams</h2>${lineChart(trend.map((t) => t.exam.name), [{ name: 'Mean', values: trend.map((t) => (t.mean != null ? Math.round(t.mean * 10) / 10 : null)) }], { unit: '%', title: 'Mean score across exams' })}</div>`;
    } catch (e) { current = ''; $('#card', el).innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
    extras().catch(() => {});
  };
  // Attendance and fees, shown only when the school's plan includes them.
  const extras = async () => {
    const [att, fee] = await Promise.all([api(`/attendance/mine?studentId=${kid}`).catch(() => null), api(`/fees/mine?studentId=${kid}`).catch(() => null)]);
    let html = '';
    if (att && att.summary.total) { const s = att.summary; html += `<div class="card no-print" style="max-width:860px;margin:16px auto"><h2 style="margin-bottom:10px">Attendance <span class="mut sm">last ${att.days} days</span></h2><div class="grid g4">${stat('Attendance', s.rate == null ? '—' : num(s.rate) + '%', { tone: 'green' })}${stat('Present', s.present, { tone: 'navy' })}${stat('Late', s.late, { tone: 'gold' })}${stat('Absent', s.absent, { tone: 'red' })}</div>${att.recent.length ? `<div class="sm" style="margin-top:12px"><b>Recent absences and lates:</b> ${att.recent.map((r) => `${esc(fmtDate(r.day))} (${esc(r.status)})`).join(', ')}</div>` : ''}</div>`; }
    if (fee && (fee.charged || fee.payments.length || fee.items?.length)) html += `<div class="card no-print" style="max-width:860px;margin:16px auto"><h2 style="margin-bottom:10px">School fees <span class="mut sm">${esc(fee.year)}</span></h2><div class="grid g3">${stat('Charged', kes(fee.charged), { tone: 'navy' })}${stat('Paid', kes(fee.paid), { tone: 'green' })}${stat(fee.balance < 0 ? 'Credit' : 'Balance', kes(Math.abs(fee.balance)), { tone: fee.balance > 0 ? 'red' : 'green' })}</div>
      ${fee.waived > 0 ? `<p class="sm mut" style="margin:8px 0 0">${kes(fee.waived)} of the charges was waived or reduced by the school.</p>` : ''}
      ${fee.items?.length ? `<div style="margin-top:12px">${table(['Charge', 'Term', 'Due', 'Amount', 'Still to pay'], (fee.lines || fee.items).map((i) => [`<b>${esc(i.name)}</b>${i.note ? `<div class="sm mut">${esc(i.note)}</div>` : ''}`, esc(i.term || 'Whole year'), i.due_date ? esc(fmtDate(i.due_date)) : '—', kes(i.amount), i.balance == null ? '' : i.balance > 0 ? `<b style="color:var(--bad)">${kes(i.balance)}</b>` : pill('Paid', 'ok')]))}</div>` : ''}
      ${fee.instructions ? `<div class="card" style="margin-top:12px"><b>How to pay</b><div class="sm" style="white-space:pre-line;margin-top:4px">${esc(fee.instructions)}</div></div>` : ''}
      ${fee.payments.length ? `<div style="margin-top:12px">${table(['Receipt', 'Date', 'Amount', ''], fee.payments.map((p) => [`<b>${esc(p.receipt_no)}</b>`, esc(fmtDate(p.paid_on)), kes(p.amount), `<button class="btn sm" data-rc="${p.id}">Print receipt</button>`]))}</div>` : ''}
      <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">${fee.payOnline ? '<button class="btn primary sm" id="mp">Pay with M-Pesa</button><button class="btn sm" id="claim">I already paid</button>' : ''}<button class="btn sm" id="stm">Print statement</button></div></div>`;
    $('#extras', el).innerHTML = html;
    $$('[data-rc]', el).forEach((b) => (b.onclick = () => printReceipt(b.dataset.rc).catch((e) => toast(e.message, 'bad'))));
    $('#stm', el)?.addEventListener('click', () => printHtml(school.statementHtml(fee)));
    $('#mp', el)?.addEventListener('click', () => payModal(fee));
    $('#claim', el)?.addEventListener('click', () => claimModal());
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Sends a payment prompt to the parent's phone, then checks every few seconds until it is paid, cancelled or times out.
  const payModal = (fee) => modal(`<h3>Pay with M-Pesa</h3><div id="box"><p class="sm mut">A prompt will appear on your phone. Enter your M-Pesa PIN to pay.</p>
      <label class="f" for="ph" style="margin-top:12px">Your Safaricom number</label><input class="i" id="ph" inputmode="tel" value="${esc(ctx.me.phone || '')}" placeholder="0712 345 678">
      <label class="f" for="am" style="margin-top:12px">Amount (KSh)</label><input class="i" id="am" inputmode="numeric" value="${fee.balance > 0 ? Math.ceil(fee.balance) : ''}">
      <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Send payment request</button></div></div>`, {
    onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => {
      const r = await api('/mpesa/pay', { method: 'POST', body: { studentId: kid, amount: $('#am', m).value, phone: $('#ph', m).value } });
      $('#box', m).innerHTML = `<p><b>${esc(r.message)}</b></p><p class="sm mut">Waiting for your payment…</p><div class="row" style="justify-content:flex-end"><button class="btn" data-close>Close</button></div>`;
      for (let i = 0; i < 30 && m.isConnected; i++) {
        await sleep(3000);
        const s = await api(`/mpesa/pay/${r.checkoutRequestId}`).catch(() => null);
        if (!s || s.status === 'pending') continue;
        const ok = s.status === 'paid';
        if (m.isConnected) $('#box', m).innerHTML = `<p><b>${ok ? 'Payment received. Thank you.' : esc(s.message || 'The payment was not completed.')}</b></p>${s.status === 'confirming' || s.status === 'unmatched' ? `<p class="sm mut">${esc(s.message || 'The school will confirm it shortly.')}</p>` : ''}<div class="row" style="justify-content:flex-end"><button class="btn primary" data-close>Done</button></div>`;
        if (ok) extras().catch(() => {});
        return;
      }
      if (m.isConnected) $('#box', m).innerHTML = '<p><b>We have not heard back yet.</b></p><p class="sm mut">If money left your phone, tell the school with "I already paid" and your M-Pesa code.</p><div class="row" style="justify-content:flex-end"><button class="btn primary" data-close>Close</button></div>';
    }); } });
  const claimModal = () => modal(`<h3>I already paid</h3><p class="sm mut">Tell the school about a payment you made, using the code in your M-Pesa message. The school checks it against its statement.</p>
      <label class="f" for="cd" style="margin-top:12px">M-Pesa code</label><input class="i" id="cd" maxlength="12" placeholder="e.g. QGH7ABC123" autocapitalize="characters">
      <label class="f" for="am" style="margin-top:12px">Amount (KSh)</label><input class="i" id="am" inputmode="numeric">
      <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Send to the school</button></div>`, {
    onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => {
      const r = await api('/mpesa/claim', { method: 'POST', body: { studentId: kid, code: $('#cd', m).value, amount: $('#am', m).value } });
      close(); toast(r.alreadyRecorded ? `That payment is already recorded (receipt ${r.receipt}).` : 'Thank you. The school will check it and update your balance.', 'ok'); if (r.alreadyRecorded) extras().catch(() => {});
    }); } });
  $('#kid', el)?.addEventListener('change', (e) => { kid = e.target.value; load(); });
  $('#ex', el).onchange = (e) => { exam = e.target.value; load(); };
  $('#pr', el).onclick = () => (current ? printHtml(current) : toast('Nothing to print yet.', 'bad'));
  await load();
}

export const views = { results, messages, calendar: school.views.calendar };
