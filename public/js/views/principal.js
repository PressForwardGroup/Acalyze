import { api } from '../api.js';
import { bandTone, esc, $, kes, stat, pill } from '../ui.js';
import { views as admin } from './admin.js';
import { staff } from './staff.js';
import { audit } from './audit.js';
import { approvals } from './approvals.js';

// The principal (head teacher, owner): sees the whole school without changing it, and has full authority over finance.
// The academic screens are the school admin's own, which the server keeps read-only for this role.
async function overview(el, ctx) {
  const money = ctx.features.fees !== false;
  const [students, teachers, classes, bal, pending] = await Promise.all([
    api('/students').catch(() => []), api('/teachers').catch(() => []), api('/classes').catch(() => []),
    money ? api('/fees/balances').catch(() => null) : null, api('/approval-requests/count').catch(() => ({ n: 0 })),
  ]);
  const s = bal?.summary;
  el.innerHTML = `${ctx.bar(`Welcome, ${esc((ctx.me.name || '').split(' ')[0] || 'Principal')}`, `${esc(ctx.me.organization || '')}: a view of the whole school`)}
  <div class="grid4" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px">${stat('Students', students.length.toLocaleString())}${stat('Teachers', teachers.length.toLocaleString())}${stat('Classes', classes.length.toLocaleString())}${money ? stat('Waiting for approval', pending.n, { accent: pending.n > 0 }) : ''}</div>
  ${s ? `<h2 style="margin:22px 0 10px">Fees this year</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px">${stat('Collected', kes(s.collected))}${stat('Expected', kes(s.charged))}${stat('Outstanding', kes(s.outstanding))}${stat('Collection rate', s.collectionRate == null ? '—' : s.collectionRate + '%', { tone: bandTone(s.collectionRate), sub: `${s.studentsOwing} students owe` })}</div>` : ''}
  <div class="row" style="margin-top:22px;gap:10px;flex-wrap:wrap"><a class="btn" href="#/app/analytics">Results and analytics</a><a class="btn" href="#/app/watch">Students to watch</a>${money ? '<a class="btn" href="#/app/fees">Fees and payments</a>' : ''}</div>`;
}

export const views = { overview, analytics: admin.analytics, watch: admin.watch, reportcards: admin.reportcards, fees: admin.fees, approvals, staff, audit };
