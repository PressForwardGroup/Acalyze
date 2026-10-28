import { api } from '../api.js';
import { esc, $, $$, kes, toast, run, modal, confirmBox, pill, fmtDate } from '../ui.js';

// Requests waiting for the principal. The principal approves or rejects; the finance officer sees their own requests.
export async function approvals(el, ctx) {
  const isP = ctx.role === 'principal';
  let tab = 'pending';
  const draw = async () => {
    const list = await api(`/approval-requests?status=${tab === 'pending' ? 'pending' : 'decided'}`);
    $('#list', el).innerHTML = list.length ? list.map((a) => `<div class="card" style="margin-bottom:12px"><div class="row" style="justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div><div class="b">${esc(a.title)}</div><div class="sm mut">${a.amount != null ? `${kes(a.amount)} · ` : ''}asked by ${esc(a.requested_by || 'unknown')} on ${esc(fmtDate(a.created_at))}</div>
        ${tab === 'decided' ? `<div style="margin-top:4px">${pill(a.status, a.status === 'approved' ? 'ok' : 'bad')} <span class="sm mut">by ${esc(a.decided_by || '—')}${a.decision_note ? ` · ${esc(a.decision_note)}` : ''}</span></div>` : ''}</div>
        <div class="row">${tab === 'pending' ? (isP ? `<button class="btn primary sm" data-ok="${a.id}">Approve</button><button class="btn sm" data-no="${a.id}">Reject</button>` : `<button class="btn sm" data-cx="${a.id}">Cancel request</button>`) : ''}</div></div></div>`).join('')
      : `<div class="card"><p class="mut" style="margin:0">${tab === 'pending' ? 'Nothing waiting for approval.' : 'No decisions yet.'}</p></div>`;
    $$('[data-ok]', el).forEach((b) => (b.onclick = async () => { if (await confirmBox('Approve this request? The action is carried out straight away.', 'Approve')) run(b, async () => { await api(`/approval-requests/${b.dataset.ok}/approve`, { method: 'POST', body: {} }); toast('Approved', 'ok'); await draw(); ctx.refreshBadges?.(); }); }));
    $$('[data-no]', el).forEach((b) => (b.onclick = () => modal(`<h3>Reject this request</h3><input class="i" id="nt" placeholder="Reason (optional)" maxlength="300"><div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn danger" id="go">Reject</button></div>`, {
      onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => { await api(`/approval-requests/${b.dataset.no}/reject`, { method: 'POST', body: { note: $('#nt', m).value } }); close(); toast('Rejected', 'ok'); await draw(); ctx.refreshBadges?.(); }); } })));
    $$('[data-cx]', el).forEach((b) => (b.onclick = () => run(b, async () => { await api(`/approval-requests/${b.dataset.cx}/cancel`, { method: 'POST', body: {} }); toast('Request cancelled', 'ok'); await draw(); })));
  };
  el.innerHTML = `${ctx.bar(isP ? 'Approvals' : 'My requests', isP ? 'Money actions waiting for your decision' : 'Actions you asked the principal to approve')}
    <div class="tabs">${[['pending', 'Waiting'], ['decided', 'Decided']].map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div><div id="list"></div>`;
  $$('.tab', el).forEach((b) => (b.onclick = () => { tab = b.dataset.t; $$('.tab', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  await draw();
}
export const views = { approvals };
