import { api } from '../api.js';
import { bandTone, esc, kes, stat, table, pill, fmtDate } from '../ui.js';
import { views as school } from './school.js';
import { approvals } from './approvals.js';
import { hello, dateLine, bandSub, waitingBar, tiles, reports } from './home.js';

// The finance officer (bursar, accounts clerk): fees and money only. No academic records.
async function overview(el, ctx) {
  const [bal, pays, mine] = await Promise.all([api('/fees/balances').catch(() => null), api('/fees/payments').catch(() => []), api('/approval-requests/count').catch(() => ({ n: 0 }))]);
  const s = bal?.summary, n = mine.n;
  const today = new Date().toISOString().slice(0, 10), todays = pays.filter((p) => String(p.paid_on).slice(0, 10) === today);
  const todayTotal = todays.reduce((a, p) => a + Number(p.amount || 0), 0);
  const owing = s?.studentsOwing ?? 0;
  const todo = [
    ['+', 'Record a payment', 'Cash, M-Pesa or bank', 'fees'],
    s && owing > 0 && ['KSh', 'Chase balances', `${owing} students owe fees`, 'fees'],
    n > 0 && ['✓', 'My requests', `${n} waiting for the principal`, 'approvals', n],
  ].filter(Boolean);
  el.innerHTML = `${ctx.bar(hello(ctx.me), dateLine(ctx.me))}
  ${n > 0 ? waitingBar(`${n} ${n === 1 ? 'request is' : 'requests are'} waiting for the principal`, '#/app/approvals', 'See requests') : ''}
  ${s ? `<h2 class="sect">Needs attention</h2><div class="grid g4 fade">
    ${stat('Collection rate', s.collectionRate == null ? '—' : s.collectionRate + '%', { tone: bandTone(s.collectionRate), sub: bandSub(s.collectionRate) })}
    ${stat('Outstanding', kes(s.outstanding), { tone: bandTone(s.collectionRate), sub: `of ${kes(s.charged)} expected` })}
    ${stat('Students who owe', owing, { tone: owing === 0 ? 'b5' : bandTone(s.collectionRate), sub: owing === 0 ? 'All clear' : 'Still to pay' })}
    ${stat('Collected today', kes(todayTotal), { sub: `${todays.length} payment${todays.length === 1 ? '' : 's'}` })}</div>` : '<div class="notice">Fees are not switched on for this school yet.</div>'}
  ${tiles(todo)}
  <h2 class="sect">Latest payments</h2>
  <div class="card pad0 fade">${table(['Receipt', 'Student', 'Amount', 'Method', 'Date'], pays.slice(0, 8).map((p) => [esc(p.receipt_no), `<b>${esc(p.full_name)}</b>`, kes(p.amount), pill(p.method), esc(p.paid_on)]), { empty: 'No payments recorded yet.' })}</div>
  ${reports({ fees: 'Fees and payments', approvals: 'My requests' }, ['fees', 'approvals'])}`;
}

export const views = { overview, fees: school.fees, approvals };
