import { api } from '../api.js';
import { esc, $, $$, kes, stat, pill, table, modal, run, toast, confirmBox, fmtDate } from '../ui.js';
import { printHtml } from './reportcard.js';
import { amountWords } from '../words.js';
import { readStatement } from '../csv.js';

// School accounts: money accounts, a budget by vote head, payment vouchers, other income, cashbooks and bank statements.
// For the principal and the finance officer.
const METHODS = { cash: 'Cash', mpesa: 'M-Pesa', bank: 'Bank', cheque: 'Cheque', other: 'Other' };
const KINDS = { cash: 'Cash', bank: 'Bank account', mpesa: 'M-Pesa Paybill' };
const INCOME = { grant: 'Grant', donation: 'Donation', hire: 'Hire of hall or bus', sales: 'Sales (farm, canteen)', interest: 'Interest', other: 'Other' };
const STATUS = { pending: ['Waiting for approval', 'warn'], approved: ['Approved, ready to pay', 'ok'], paid: ['Paid', 'ok'], rejected: ['Rejected', 'bad'], cancelled: ['Cancelled', ''] };
const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const opt = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');

export async function books(el, ctx) {
  let tab = 'overview', year = String(new Date().getFullYear());
  const isP = ctx.role === 'principal';

  const voucherHtml = (d) => {
    const v = d.voucher, s = d.school, row = (a, b) => `<tr><td style="width:34%"><b>${a}</b></td><td>${b}</td></tr>`;
    return `<div class="rcpt">${s.logo_url ? `<img class="logo" src="${esc(s.logo_url)}" alt="">` : ''}<h2>${esc(s.name)}</h2><div class="ti">PAYMENT VOUCHER</div>
      <table>${row('Voucher no.', `<b>${esc(v.voucher_no)}</b>`)}${row('Date', esc(fmtDate(v.expense_date)))}${row('Payee', esc(v.payee))}${row('Being payment for', esc(v.description))}${row('Vote head', esc(v.head))}${v.invoice_ref ? row('Invoice or reference', esc(v.invoice_ref)) : ''}${row('Amount', `<b>${kes(v.amount)}</b>`)}${row('Amount in words', esc(amountWords(v.amount)))}
        ${v.status === 'paid' ? row('Paid', `${esc(METHODS[v.method] || v.method)} from ${esc(v.account || '')}${v.reference ? `, ref ${esc(v.reference)}` : ''}, on ${esc(fmtDate(v.paid_on))}`) : row('Status', esc((STATUS[v.status] || [v.status])[0]))}</table>
      <div class="ln" style="margin-top:22px">Prepared by: <b>${esc(v.requested_by || '')}</b></div>
      <div class="ln" style="margin-top:10px">Approved by: ${d.approvedBy ? `<b>${esc(d.approvedBy)}</b>` : '<span class="bl"></span>'} &nbsp; Signature: <span class="bl"></span></div>
      <div class="ln" style="margin-top:10px">Received by (payee): <span class="bl"></span> &nbsp; Signature &amp; date: <span class="bl"></span></div></div>`;
  };

  // ---- overview ----
  async function overview(p) {
    const s = await api(`/books/summary?year=${year}`);
    p.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px">${stat('Income', kes(s.income.total), { tone: 'green', sub: `Fees ${kes(s.income.fees)} · other ${kes(s.income.otherTotal)}` })}${stat('Spent', kes(s.spent), { tone: 'red' })}${stat('Committed', kes(s.committed), { tone: 'gold', sub: 'vouchers not yet paid' })}${stat(s.net < 0 ? 'Deficit' : 'Surplus', kes(Math.abs(s.net)), { tone: s.net < 0 ? 'red' : 'navy' })}${stat('Budget', kes(s.budget), { tone: 'navy' })}</div>
      <h2 style="margin:20px 0 8px">Money accounts</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px">${s.accounts.map((a) => stat(a.name, kes(a.balance), { sub: KINDS[a.kind] })).join('') || '<div class="card"><p class="mut" style="margin:0">Add your bank, cash and M-Pesa accounts under <b>Setup</b> first.</p></div>'}</div>
      ${s.income.other.length ? `<h2 style="margin:20px 0 8px">Other income</h2><div class="card pad0">${table(['Kind', 'Total'], s.income.other.map((o) => [esc(INCOME[o.kind] || o.kind), kes(o.total)]))}</div>` : ''}
      <p class="sm mut" style="margin-top:12px">Income is fees received (after refunds) plus other income recorded here. Spent is vouchers that have been paid. Committed is vouchers waiting for approval or payment.</p>`;
  }

  // ---- vouchers ----
  async function vouchers(p) {
    let status = '';
    const [heads, accts] = await Promise.all([api('/books/heads'), api('/books/accounts')]), activeAccts = accts.filter((a) => a.active);
    const draw = async () => {
      const list = await api(`/books/vouchers?year=${year}${status ? `&status=${status}` : ''}`);
      $('#vl', p).innerHTML = table(['Voucher', 'Payee and purpose', 'Vote head', 'Amount', 'Status', ''], list.map((v) => [`<b>${esc(v.voucher_no)}</b><div class="sm mut">${esc(fmtDate(v.expense_date))}</div>`, `<b>${esc(v.payee)}</b><div class="sm mut">${esc(v.description)}</div>`, esc(v.head),
        `<b>${kes(v.amount)}</b>${v.over_budget ? `<div>${pill('Over budget', 'bad')}</div>` : ''}`, pill(...(STATUS[v.status] || [v.status, ''])) + (v.status === 'paid' ? `<div class="sm mut">${esc(v.account || '')}</div>` : ''),
        `<div class="row" style="gap:6px"><button class="btn sm" data-pr="${v.id}">Print</button>${v.status === 'approved' ? `<button class="btn sm primary" data-pay="${v.id}">Pay</button>` : ''}${v.status === 'pending' || v.status === 'approved' ? `<button class="btn sm danger" data-cx="${v.id}">Cancel</button>` : ''}</div>`]), { empty: 'No vouchers yet.' });
      $$('[data-pr]', p).forEach((b) => (b.onclick = () => run(b, async () => printHtml(voucherHtml(await api(`/books/vouchers/${b.dataset.pr}`))))));
      $$('[data-cx]', p).forEach((b) => (b.onclick = async () => { if (await confirmBox('Cancel this voucher? Nothing is paid.', 'Cancel voucher')) run(b, async () => { await api(`/books/vouchers/${b.dataset.cx}/cancel`, { method: 'POST', body: {} }); toast('Cancelled', 'ok'); draw(); }); }));
      $$('[data-pay]', p).forEach((b) => (b.onclick = () => {
        const v = list.find((x) => x.id === b.dataset.pay);
        modal(`<h3>Pay voucher ${esc(v.voucher_no)}</h3><p class="sm mut">${kes(v.amount)} to ${esc(v.payee)}</p>
          <div class="form-grid"><div><label class="f" for="ac">Paid from</label><select class="i" id="ac">${opt(activeAccts.map((a) => [a.id, `${a.name} (${kes(a.balance)})`]))}</select></div><div><label class="f" for="mt">How</label><select class="i" id="mt">${opt(Object.entries(METHODS))}</select></div>
            <div><label class="f" for="rf">Reference (cheque no, M-Pesa code)</label><input class="i" id="rf" maxlength="60"></div><div><label class="f" for="dt">Date paid</label><input class="i" id="dt" type="date" value="${today()}"></div></div>
          <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go" ${activeAccts.length ? '' : 'disabled'}>Record payment</button></div>`, {
          onMount: (m, close) => { const guess = () => { const a = activeAccts.find((x) => x.id === $('#ac', m).value); $('#mt', m).value = a?.kind === 'cash' ? 'cash' : a?.kind === 'mpesa' ? 'mpesa' : 'bank'; }; guess(); $('#ac', m).onchange = guess;
            $('#go', m).onclick = (e) => run(e.currentTarget, async () => { await api(`/books/vouchers/${v.id}/pay`, { method: 'POST', body: { accountId: $('#ac', m).value, method: $('#mt', m).value, reference: $('#rf', m).value, paidOn: $('#dt', m).value } }); close(); toast('Paid and entered in the cashbook', 'ok'); draw(); }); } });
      }));
    };
    p.innerHTML = `<div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:14px;align-items:end"><button class="btn primary" id="nv">+ New voucher</button><div><label class="f" for="sf">Show</label><select class="i" id="sf"><option value="">All</option>${opt(Object.entries(STATUS).map(([k, v]) => [k, v[0]]))}</select></div></div><div class="card pad0" id="vl"></div>`;
    $('#sf', p).onchange = (e) => { status = e.target.value; draw(); };
    $('#nv', p).onclick = () => modal(`<h3>New payment voucher</h3><div class="form-grid"><div><label class="f" for="hd">Vote head *</label><select class="i" id="hd">${opt(heads.filter((h) => h.active).map((h) => [h.id, h.name]))}</select></div><div><label class="f" for="am">Amount (KSh) *</label><input class="i" id="am" inputmode="decimal"></div>
        <div><label class="f" for="py">Payee *</label><input class="i" id="py" maxlength="100" placeholder="Supplier or person"></div><div><label class="f" for="iv">Supplier invoice or reference</label><input class="i" id="iv" maxlength="60"></div></div>
        <label class="f" for="ds" style="margin-top:10px">What is it for? *</label><input class="i" id="ds" maxlength="200"><label class="f" for="dt" style="margin-top:10px">Date</label><input class="i" id="dt" type="date" value="${today()}">
        <p class="sm mut" style="margin-top:10px">${isP ? 'As the principal, your vouchers are approved straight away.' : 'The principal approves vouchers above the limit they set. Pay it once it is approved.'}</p>
        <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Save voucher</button></div>`, {
      onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => {
        const r = await api('/books/vouchers', { method: 'POST', body: { headId: $('#hd', m).value, amount: $('#am', m).value, payee: $('#py', m).value, description: $('#ds', m).value, invoiceRef: $('#iv', m).value, expenseDate: $('#dt', m).value, year } });
        close(); toast(r.pendingApproval ? r.message : `Voucher ${r.voucherNo} saved${r.overBudget ? '. It is over the budget for this vote head.' : '.'}`, r.overBudget ? 'bad' : 'ok'); draw();
      }); } });
    await draw();
  }

  // ---- budget and vote heads ----
  async function budget(p) {
    const b = await api(`/books/budget?year=${year}`);
    p.innerHTML = `<div class="card pad0">${table(['Vote head', 'Budget for ' + year, 'Committed', 'Spent', 'Available', ''], b.heads.map((h) => [`<b${h.active ? '' : ' class="mut"'}>${esc(h.name)}</b>`, `<input class="i" data-bh="${h.id}" inputmode="decimal" style="width:130px" value="${h.budget ?? ''}" placeholder="No limit">`, kes(h.committed), kes(h.spent),
        h.available == null ? '—' : h.available < 0 ? `<b style="color:var(--bad)">${kes(h.available)}</b>` : kes(h.available), `<button class="btn sm" data-tg="${h.id}" data-on="${h.active ? 1 : 0}">${h.active ? 'Switch off' : 'Switch on'}</button>`]))}</div>
      <div class="row" style="margin-top:14px;gap:8px"><button class="btn primary" id="sv">Save budget</button><button class="btn" id="ah">+ Add vote head</button></div>
      <p class="sm mut" style="margin-top:10px">Leave a budget empty for no limit. A voucher that would take a vote head over its budget is flagged "Over budget" for the principal.</p>`;
    $('#sv', p).onclick = (e) => run(e.currentTarget, async () => { await api('/books/budget', { method: 'PUT', body: { year, lines: $$('[data-bh]', p).map((i) => ({ headId: i.dataset.bh, amount: i.value.trim() === '' ? null : i.value })) } }); toast('Budget saved', 'ok'); budget(p); });
    $$('[data-tg]', p).forEach((x) => (x.onclick = () => run(x, async () => { await api(`/books/heads/${x.dataset.tg}`, { method: 'PATCH', body: { active: x.dataset.on !== '1' } }); budget(p); })));
    $('#ah', p).onclick = () => modal(`<h3>Add a vote head</h3><input class="i" id="nm" maxlength="60" placeholder="e.g. Library books"><div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Add</button></div>`, {
      onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => { await api('/books/heads', { method: 'POST', body: { name: $('#nm', m).value } }); close(); budget(p); }); } });
  }

  // ---- cashbook ----
  async function cashbook(p) {
    const accts = await api('/books/accounts');
    if (!accts.length) { p.innerHTML = '<div class="card"><p class="mut" style="margin:0">Add a money account under <b>Setup</b> first.</p></div>'; return; }
    let accountId = accts.find((a) => a.active)?.id || accts[0].id, from = '', to = today(), d;
    const draw = async () => {
      d = await api(`/books/cashbook?accountId=${accountId}${from ? `&from=${from}` : ''}&to=${to}`);
      $('#cb', p).innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:12px">${stat('Brought forward', kes(d.broughtForward))}${stat('Money in', kes(d.totalIn), { tone: 'green' })}${stat('Money out', kes(d.totalOut), { tone: 'red' })}${stat('Balance', kes(d.closing), { tone: 'navy' })}</div>
        <div class="card pad0">${table(['Date', 'Details', 'In', 'Out', 'Balance'], d.rows.map((r) => [esc(fmtDate(r.date)), esc(r.text) + (r.voided ? ' <span class="sm mut">(voided)</span>' : ''), r.in ? kes(r.in) : '', r.out ? kes(r.out) : '', kes(r.balance)]), { empty: 'No entries in this period.' })}</div>
        ${d.account.receives.length ? '' : '<p class="sm mut" style="margin-top:10px">No payment methods are linked to this account, so fee receipts do not appear here. Link them under Setup.</p>'}`;
    };
    p.innerHTML = `<div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:14px;align-items:end"><div><label class="f" for="ca">Account</label><select class="i" id="ca">${opt(accts.map((a) => [a.id, a.name]), accountId)}</select></div><div><label class="f" for="cf">From</label><input class="i" id="cf" type="date"></div><div><label class="f" for="ct">To</label><input class="i" id="ct" type="date" value="${to}"></div><button class="btn" id="pr">Print</button><button class="btn" id="tf">+ Move money between accounts</button></div><div id="cb"></div>`;
    $('#ca', p).onchange = (e) => { accountId = e.target.value; draw(); };
    $('#cf', p).onchange = (e) => { from = e.target.value; draw(); };
    $('#ct', p).onchange = (e) => { to = e.target.value || to; draw(); };
    $('#pr', p).onclick = () => printHtml(`<div class="rcpt"><h2>Cashbook: ${esc(d.account.name)}</h2><div class="ti">${esc(fmtDate(d.from))} to ${esc(fmtDate(d.to))}</div><table><tr><td><b>Brought forward</b></td><td></td><td></td><td style="text-align:right"><b>${kes(d.broughtForward)}</b></td></tr>${d.rows.map((r) => `<tr><td>${esc(fmtDate(r.date))}</td><td>${esc(r.text)}</td><td style="text-align:right">${r.in ? kes(r.in) : ''}${r.out ? '-' + kes(r.out) : ''}</td><td style="text-align:right">${kes(r.balance)}</td></tr>`).join('')}<tr><td><b>Closing balance</b></td><td></td><td></td><td style="text-align:right"><b>${kes(d.closing)}</b></td></tr></table></div>`);
    $('#tf', p).onclick = () => modal(`<h3>Move money between accounts</h3><p class="sm mut">For example, cash banked, or money drawn for petty cash.</p><div class="form-grid"><div><label class="f" for="fa">From</label><select class="i" id="fa">${opt(accts.filter((a) => a.active).map((a) => [a.id, a.name]), accountId)}</select></div><div><label class="f" for="ta">To</label><select class="i" id="ta">${opt(accts.filter((a) => a.active).map((a) => [a.id, a.name]))}</select></div>
        <div><label class="f" for="am">Amount (KSh)</label><input class="i" id="am" inputmode="decimal"></div><div><label class="f" for="dt">Date</label><input class="i" id="dt" type="date" value="${today()}"></div></div><label class="f" for="nt" style="margin-top:10px">Note (optional)</label><input class="i" id="nt" maxlength="200">
        <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Move money</button></div>`, {
      onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => { await api('/books/transfers', { method: 'POST', body: { fromId: $('#fa', m).value, toId: $('#ta', m).value, amount: $('#am', m).value, date: $('#dt', m).value, note: $('#nt', m).value } }); close(); toast('Recorded', 'ok'); draw(); }); } });
    await draw();
  }

  // ---- other income ----
  async function income(p) {
    const [list, accts] = await Promise.all([api(`/books/income?year=${year}`), api('/books/accounts')]), act = accts.filter((a) => a.active);
    p.innerHTML = `<div class="row" style="margin-bottom:14px"><button class="btn primary" id="ni">+ Record income</button></div><div class="card pad0">${table(['Date', 'From', 'Kind', 'Account', 'Amount', ''], list.map((i) => [esc(fmtDate(i.received_on)), `<b>${esc(i.source)}</b>${i.note ? `<div class="sm mut">${esc(i.note)}</div>` : ''}`, esc(INCOME[i.kind] || i.kind), esc(i.account),
      i.reversed_at ? `<s class="mut">${i.amount.toLocaleString('en-KE')}</s> ${pill('Reversed', 'bad')}` : kes(i.amount), i.reversed_at ? '' : `<button class="btn sm danger" data-rv="${i.id}">Reverse</button>`]), { empty: `No other income recorded for ${year}.` })}</div>
      <p class="sm mut" style="margin-top:10px">Fees are counted automatically. Record everything else here: grants, donations, hire of the hall or bus, farm or canteen sales, interest.</p>`;
    $('#ni', p).onclick = () => modal(`<h3>Record income</h3><div class="form-grid"><div><label class="f" for="ac">Into account</label><select class="i" id="ac">${opt(act.map((a) => [a.id, a.name]))}</select></div><div><label class="f" for="kd">Kind</label><select class="i" id="kd">${opt(Object.entries(INCOME))}</select></div>
        <div><label class="f" for="am">Amount (KSh)</label><input class="i" id="am" inputmode="decimal"></div><div><label class="f" for="dt">Date received</label><input class="i" id="dt" type="date" value="${today()}"></div></div>
        <label class="f" for="sr" style="margin-top:10px">Where from? *</label><input class="i" id="sr" maxlength="100" placeholder="e.g. Hall hire, Mr Otieno"><label class="f" for="rf" style="margin-top:10px">Reference (optional)</label><input class="i" id="rf" maxlength="60">
        <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go" ${act.length ? '' : 'disabled'}>Save</button></div>`, {
      onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => { await api('/books/income', { method: 'POST', body: { accountId: $('#ac', m).value, kind: $('#kd', m).value, amount: $('#am', m).value, receivedOn: $('#dt', m).value, source: $('#sr', m).value, reference: $('#rf', m).value } }); close(); toast('Recorded', 'ok'); income(p); }); } });
    $$('[data-rv]', p).forEach((b) => (b.onclick = () => modal(`<h3>Reverse this income</h3><p class="sm mut">It stays on record, marked as reversed.</p><input class="i" id="why" maxlength="200" placeholder="Why? *"><div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn danger" id="go">Reverse</button></div>`, {
      onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => { await api(`/books/income/${b.dataset.rv}/reverse`, { method: 'POST', body: { reason: $('#why', m).value } }); close(); income(p); }); } })));
  }

  // ---- bank statement ----
  async function statement(p) {
    const accts = (await api('/books/accounts')).filter((a) => a.active && a.kind !== 'cash');
    if (!accts.length) { p.innerHTML = '<div class="card"><p class="mut" style="margin:0">Add a bank or M-Pesa account under <b>Setup</b> to match its statement.</p></div>'; return; }
    let accountId = accts[0].id;
    const draw = async () => {
      const d = await api(`/books/statement?accountId=${accountId}`), s = d.summary;
      $('#sr', p).innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:12px">${stat('Statement lines not matched', s.unmatched, { tone: s.unmatched ? 'red' : 'green', sub: kes(s.unmatchedTotal) })}${stat('In the books, not on the statement', s.unreconciledEntries, { tone: s.unreconciledEntries ? 'gold' : 'green', sub: kes(s.unreconciledTotal) })}${stat('Lines imported', s.lines)}</div>
        <h2 style="margin:6px 0 8px">Statement lines</h2><div class="card pad0">${table(['Date', 'Details', 'Amount', 'Status', ''], d.lines.map((l) => [esc(fmtDate(l.date)), `${esc(l.description || '')}${l.reference ? `<div class="sm mut">${esc(l.reference)}</div>` : ''}`, `<b style="color:${l.amount < 0 ? 'var(--bad)' : 'var(--ok)'}">${kes(l.amount)}</b>`,
          pill(l.status === 'matched' ? 'Matched' : l.status === 'ignored' ? 'Ignored' : 'Not matched', l.status === 'matched' ? 'ok' : l.status === 'ignored' ? '' : 'warn'),
          `<div class="row" style="gap:6px">${l.status === 'unmatched' ? `<button class="btn sm" data-mt="${l.id}">Match…</button><button class="btn sm" data-ig="${l.id}">Ignore</button>` : `<button class="btn sm" data-um="${l.id}">Undo</button>`}</div>`]), { empty: 'No statement imported yet.' })}</div>
        <h2 style="margin:20px 0 8px">In the books but not on the statement</h2><div class="card pad0">${table(['Date', 'Details', 'Amount'], d.unreconciled.map((e) => [esc(fmtDate(e.date)), esc(e.text), kes(e.amount)]), { empty: 'Everything in the books has been found on the statement.' })}</div>
        <p class="sm mut" style="margin-top:10px">Money in transit (a cheque not yet cashed, a deposit not yet cleared) shows under "in the books but not on the statement" until it appears.</p>`;
      $$('[data-ig]', p).forEach((x) => (x.onclick = () => run(x, async () => { await api(`/books/statement/${x.dataset.ig}/ignore`, { method: 'POST', body: {} }); draw(); })));
      $$('[data-um]', p).forEach((x) => (x.onclick = () => run(x, async () => { await api(`/books/statement/${x.dataset.um}/unmatch`, { method: 'POST', body: {} }); draw(); })));
      $$('[data-mt]', p).forEach((b) => (b.onclick = () => {
        const l = d.lines.find((x) => x.id === b.dataset.mt), cands = d.unreconciled.filter((e) => Math.abs(e.amount - l.amount) < 0.005);
        modal(`<h3>Match this line</h3><p class="sm mut">${esc(fmtDate(l.date))} · ${esc(l.description || '')} · <b>${kes(l.amount)}</b></p>${cands.length ? cands.map((e) => `<div class="row" style="gap:8px;padding:6px 0;border-bottom:1px solid var(--line)"><div style="flex:1">${esc(fmtDate(e.date))} · ${esc(e.text)}</div><button class="btn sm primary" data-pk="${esc(e.ref)}">Match</button></div>`).join('') : '<p class="mut">Nothing in the books has the same amount. Record the payment, voucher or income first, then match it.</p>'}
          <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-close>Close</button></div>`, {
          onMount: (m, close) => $$('[data-pk]', m).forEach((x) => (x.onclick = () => run(x, async () => { await api(`/books/statement/${l.id}/match`, { method: 'POST', body: { ref: x.dataset.pk } }); close(); draw(); }))) });
      }));
    };
    p.innerHTML = `<div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:14px;align-items:end"><div><label class="f" for="sa">Account</label><select class="i" id="sa">${opt(accts.map((a) => [a.id, a.name]))}</select></div><div><label class="f" for="sf">Bank statement (CSV file)</label><input class="i" id="sf" type="file" accept=".csv,text/csv"></div></div><div id="sr"></div>`;
    $('#sa', p).onchange = (e) => { accountId = e.target.value; draw(); };
    $('#sf', p).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const r = readStatement(await f.text());
      if (r.error) { toast(r.error, 'bad'); e.target.value = ''; return; }
      if (await confirmBox(`Found ${r.lines.length} transactions, from ${fmtDate(r.lines[0].date)} to ${fmtDate(r.lines.at(-1).date)}. Import them? Lines already imported are skipped.`, 'Import')) {
        try { const x = await api('/books/statement/import', { method: 'POST', body: { accountId, lines: r.lines } }); toast(`${x.added} added, ${x.skipped} already there, ${x.matched} matched automatically`, 'ok'); await draw(); } catch (err) { toast(err.message, 'bad'); }
      }
      e.target.value = '';
    };
    await draw();
  }

  // ---- setup: accounts and the approval limit ----
  async function setup(p) {
    const [accts, set] = await Promise.all([api('/books/accounts'), api('/books/settings')]);
    const form = (a = {}) => `<div class="form-grid"><div><label class="f" for="nm">Name *</label><input class="i" id="nm" maxlength="60" value="${esc(a.name || '')}" placeholder="e.g. Equity bank account"></div><div><label class="f" for="kd">Kind</label><select class="i" id="kd">${opt(Object.entries(KINDS), a.kind || 'bank')}</select></div>
      <div><label class="f" for="ob">Opening balance (KSh)</label><input class="i" id="ob" inputmode="decimal" value="${a.opening_balance ?? 0}"></div><div><label class="f" for="od">Books start on</label><input class="i" id="od" type="date" value="${a.opening_date || today()}"></div>
      <div style="grid-column:1/-1"><span class="f">Fee payments received by this account</span><div class="row" style="flex-wrap:wrap;gap:6px 14px;margin-top:4px">${Object.entries(METHODS).map(([k, v]) => `<label class="row" style="gap:5px"><input type="checkbox" data-rc="${k}" ${(a.receives || []).includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}</div></div></div>`;
    const read = (m) => ({ name: $('#nm', m).value, kind: $('#kd', m).value, openingBalance: $('#ob', m).value, openingDate: $('#od', m).value, receives: $$('[data-rc]:checked', m).map((c) => c.dataset.rc) });
    p.innerHTML = `<div class="row" style="margin-bottom:14px"><button class="btn primary" id="aa">+ Add account</button></div><div class="card pad0">${table(['Account', 'Kind', 'Fee payments in', 'Balance', ''], accts.map((a) => [`<b${a.active ? '' : ' class="mut"'}>${esc(a.name)}</b>${a.active ? '' : ' <span class="sm mut">(switched off)</span>'}`, esc(KINDS[a.kind]), esc(a.receives.map((m) => METHODS[m]).join(', ') || '—'), kes(a.balance), `<button class="btn sm" data-ea="${a.id}">Edit</button>`]), { empty: 'No accounts yet. Add your bank, cash and M-Pesa accounts.' })}</div>
      <div class="card" style="margin-top:18px"><h2 style="margin-bottom:6px">Voucher approval limit</h2><p class="sm mut">Vouchers up to this amount are approved straight away. Anything above needs the principal. Enter 0 to approve every voucher.</p>
        <div class="row" style="gap:8px;align-items:end"><div><label class="f" for="th">Amount (KSh)</label><input class="i" id="th" inputmode="decimal" value="${set.approvalThreshold}" ${isP ? '' : 'disabled'}></div>${isP ? '<button class="btn" id="st">Save</button>' : '<span class="sm mut">Only the principal can change this.</span>'}</div></div>
      <p class="sm mut" style="margin-top:10px">Each payment method (cash, M-Pesa, bank, cheque, other) goes to one account, so every fee receipt appears in exactly one cashbook.</p>`;
    $('#aa', p).onclick = () => modal(`<h3>Add an account</h3>${form({ receives: ['bank', 'cheque'] })}<div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Add account</button></div>`, {
      onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => { await api('/books/accounts', { method: 'POST', body: read(m) }); close(); setup(p); }); } });
    $$('[data-ea]', p).forEach((b) => (b.onclick = () => {
      const a = accts.find((x) => x.id === b.dataset.ea);
      modal(`<h3>Edit ${esc(a.name)}</h3>${form(a)}<label class="row" style="gap:8px;margin-top:12px"><input type="checkbox" id="ac" ${a.active ? 'checked' : ''}> Account is in use</label><div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Save</button></div>`, {
        onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => { await api(`/books/accounts/${a.id}`, { method: 'PATCH', body: { ...read(m), active: $('#ac', m).checked } }); close(); setup(p); }); } });
    }));
    $('#st', p)?.addEventListener('click', (e) => run(e.currentTarget, async () => { await api('/books/settings', { method: 'PUT', body: { approvalThreshold: $('#th', p).value } }); toast('Saved', 'ok'); }));
  }

  const TABS = [['overview', 'Overview', overview], ['vouchers', 'Vouchers', vouchers], ['budget', 'Budget', budget], ['cashbook', 'Cashbook', cashbook], ['income', 'Other income', income], ['statement', 'Bank statement', statement], ['setup', 'Setup', setup]];
  const years = [0, 1, 2].map((i) => String(new Date().getFullYear() - i));
  const paint = () => {
    $$('.tab', el).forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    TABS.find((t) => t[0] === tab)[2]($('#pane', el)).catch((e) => { $('#pane', el).innerHTML = `<div class="card"><p class="mut" style="margin:0">${esc(e.message)}</p></div>`; });
  };
  el.innerHTML = `${ctx.bar('School accounts', 'Budget, vouchers, cashbooks and bank statements', `<select class="i" id="yr" style="width:auto">${years.map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>`)}
    <div class="tabs">${TABS.map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div><div id="pane"></div>`;
  $('#yr', el).onchange = (e) => { year = e.target.value; paint(); };
  $$('.tab', el).forEach((b) => (b.onclick = () => { tab = b.dataset.t; paint(); }));
  paint();
}

export const views = { books };
