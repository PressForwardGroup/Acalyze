import { api } from '../api.js';
import { esc, $, $$, toast, lineChart } from '../ui.js';
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
      ${fee.items?.length ? `<div style="margin-top:12px">${table(['Charge', 'Term', 'Due', 'Amount', 'Still to pay'], (fee.lines || fee.items).map((i) => [`<b>${esc(i.name)}</b>${i.note ? `<div class="sm mut">${esc(i.note)}</div>` : ''}`, esc(i.term || 'Whole year'), i.due_date ? esc(fmtDate(i.due_date)) : '—', kes(i.amount), i.balance == null ? '' : i.balance > 0 ? `<b style="color:var(--bad)">${kes(i.balance)}</b>` : pill('Paid', 'ok')]))}</div>` : ''}
      ${fee.instructions ? `<div class="card" style="margin-top:12px"><b>How to pay</b><div class="sm" style="white-space:pre-line;margin-top:4px">${esc(fee.instructions)}</div></div>` : ''}
      ${fee.payments.length ? `<div style="margin-top:12px">${table(['Receipt', 'Date', 'Amount', ''], fee.payments.map((p) => [`<b>${esc(p.receipt_no)}</b>`, esc(fmtDate(p.paid_on)), kes(p.amount), `<button class="btn sm" data-rc="${p.id}">Print receipt</button>`]))}</div>` : ''}
      <div style="margin-top:12px"><button class="btn sm" id="stm">Print statement</button></div></div>`;
    $('#extras', el).innerHTML = html;
    $$('[data-rc]', el).forEach((b) => (b.onclick = () => printReceipt(b.dataset.rc).catch((e) => toast(e.message, 'bad'))));
    $('#stm', el)?.addEventListener('click', () => printHtml(school.statementHtml(fee)));
  };
  $('#kid', el)?.addEventListener('change', (e) => { kid = e.target.value; load(); });
  $('#ex', el).onchange = (e) => { exam = e.target.value; load(); };
  $('#pr', el).onclick = () => (current ? printHtml(current) : toast('Nothing to print yet.', 'bad'));
  await load();
}

export const views = { results, messages, calendar: school.views.calendar };
