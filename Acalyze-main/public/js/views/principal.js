import { api } from '../api.js';
import { bandTone, esc, $, kes, stat, pill } from '../ui.js';
import { hello, dateLine, countTone, countSub, bandSub, waitingBar, tiles, reports } from './home.js';
import { views as admin } from './admin.js';
import { staff } from './staff.js';
import { audit } from './audit.js';
import { approvals } from './approvals.js';

// The principal (head teacher, owner): sees the whole school without changing it, and has full authority over finance.
// The academic screens are the school admin's own, which the server keeps read-only for this role.
async function overview(el, ctx) {
  const money = ctx.features.fees !== false;
  const [students, teachers, classes, bal, pending, ov] = await Promise.all([
    api('/students').catch(() => []), api('/teachers').catch(() => []), api('/classes').catch(() => []),
    money ? api('/fees/balances').catch(() => null) : null, api('/approval-requests/count').catch(() => ({ n: 0 })), api('/analytics/overview').catch(() => null),
  ]);
  const risk = ov?.latestExam ? await api(`/analytics/risk?examId=${ov.latestExam.id}`).catch(() => null) : null;
  const s = bal?.summary, n = pending.n;
  const prog = (ov?.entryProgress || []).filter((p) => p.students > 0), total = prog.reduce((a, p) => a + p.students, 0), done = prog.reduce((a, p) => a + p.with_marks, 0);
  const markPct = ov?.latestExam && total ? (done / total) * 100 : null;
  const rc = risk?.counts, help = rc ? rc.high + rc.medium + rc.watch : null;
  const helpTone = !rc ? '' : rc.high ? 'b1' : rc.medium ? 'b2' : rc.watch ? 'b3' : 'b5';
  const todo = [
    n > 0 && ['✓', 'Approve requests', money ? 'Fee changes are waiting for you' : 'Requests are waiting for you', 'approvals', n],
    help > 0 && ['⚠', 'Students to watch', `${help} student${help === 1 ? '' : 's'} need support`, 'watch'],
    money && s && ['KSh', 'Fees and payments', s.studentsOwing ? `${s.studentsOwing} students owe fees` : 'Everyone is up to date', 'fees'],
    ['▤', 'Results and analytics', ov?.latestExam?.name || 'How each class is doing', 'analytics'],
  ].filter(Boolean).slice(0, 4);
  el.innerHTML = `${ctx.bar(hello(ctx.me, 'Principal'), dateLine(ctx.me))}
  ${n > 0 ? waitingBar(`${n} ${n === 1 ? 'request is' : 'requests are'} waiting for you`, '#/app/approvals') : ''}
  <h2 class="sect">Needs attention</h2><div class="grid g4 fade">
    ${s ? stat('Fees collected', s.collectionRate == null ? '—' : s.collectionRate + '%', { tone: bandTone(s.collectionRate), sub: bandSub(s.collectionRate, `${kes(s.outstanding)} outstanding`) }) : ''}
    ${rc ? stat('Students needing support', help, { tone: helpTone, sub: help ? `${rc.high} critical · ${rc.medium} at risk · ${rc.watch} to monitor` : 'No one flagged' }) : ''}
    ${markPct != null ? stat('Marks entered', Math.round(markPct) + '%', { tone: bandTone(markPct), sub: bandSub(markPct, ov.latestExam.name) }) : ''}
    ${stat('Waiting for approval', n, { tone: countTone(n), sub: countSub(n) })}</div>
  ${tiles(todo)}
  <h2 class="sect">School at a glance</h2><div class="grid g4 fade">${stat('Students', students.length.toLocaleString())}${stat('Teachers', teachers.length.toLocaleString())}${stat('Classes', classes.length.toLocaleString())}${s ? stat('Fees collected (KSh)', kes(s.collected).replace('KSh', '').trim(), { sub: `of ${kes(s.charged)} expected` }) : ''}</div>
  ${reports({ analytics: 'Results and analytics', watch: 'Students to watch', reportcards: 'Report cards', ...(money ? { fees: 'Fees and payments' } : {}) }, ['analytics', 'watch', ...(money ? ['fees'] : [])])}`;
}

export const views = { overview, analytics: admin.analytics, watch: admin.watch, reportcards: admin.reportcards, fees: admin.fees, approvals, staff, audit };
