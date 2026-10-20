import { api } from '../api.js';
import { esc, kes, stat, table, pill, fmtDate } from '../ui.js';
import { views as school } from './school.js';
import { approvals } from './approvals.js';

// The finance officer (bursar, accounts clerk): fees and money only. No academic records.
async function overview(el, ctx) {
  const [bal, pays, mine] = await Promise.all([api('/fees/balances').catch(() => null), api('/fees/payments').catch(() => []), api('/approval-requests/count').catch(() => ({ n: 0 }))]);
  const s = bal?.summary;
  el.innerHTML = `${ctx.bar(`Welcome, ${esc((ctx.me.name || '').split(' ')[0] || 'there')}`, `${esc(ctx.me.organization || '')}: fees and payments`)}
  ${s ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px">${stat('Collected', kes(s.collected))}${stat('Expected', kes(s.charged))}${stat('Outstanding', kes(s.outstanding))}${stat('Collection rate', s.collectionRate == null ? '—' : s.collectionRate + '%', { sub: `${s.studentsOwing} students owe` })}</div>` : '<div class="notice">Fees are not switched on for this school yet.</div>'}
  <h2 style="margin:22px 0 10px">Latest payments</h2>
  <div class="card pad0">${table(['Receipt', 'Student', 'Amount', 'Method', 'Date'], pays.slice(0, 8).map((p) => [esc(p.receipt_no), `<b>${esc(p.full_name)}</b>`, kes(p.amount), pill(p.method), esc(p.paid_on)]), { empty: 'No payments recorded yet.' })}</div>
  ${mine.n ? `<p style="margin-top:14px"><a href="#/app/approvals">${mine.n} request${mine.n === 1 ? '' : 's'} waiting for the principal</a></p>` : ''}`;
}

export const views = { overview, fees: school.fees, approvals };
