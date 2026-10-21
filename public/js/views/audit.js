import { api } from '../api.js';
import { esc, $, $$, table, pill } from '../ui.js';

// The school's audit trail: who did what, and when.
const WHAT = {
  'staff.create': 'Added a staff account', 'staff.update': 'Changed a staff account', 'staff.reset_password': "Reset someone's password",
  'password.set': 'Chose a new password', 'password.change': 'Changed their password', 'sessions.revoke_all': 'Signed out of all devices',
  'support.open_school': 'Acalyze support opened your school', 'settings.update': 'Changed school settings',
  'fee_item.create': 'Added a charge', 'fee_item.update': 'Edited a draft charge', 'fee_item.publish': 'Published charges', 'fee_item.assign': 'Assigned students to a charge', 'fee_item.delete': 'Deleted a charge', 'fees.boarding': 'Updated boarders', 'fees.instructions': 'Changed payment instructions', 'payment.record': 'Recorded a payment', 'payment.void': 'Voided a payment',
  'approval.request': 'Asked for approval', 'approval.approve': 'Approved a request', 'approval.reject': 'Rejected a request', 'approval.cancel': 'Cancelled a request',
};
const AREA = { security: ['Security', 'warn'], academic: ['School', ''], finance: ['Finance', 'ok'] };
const WHO = { platform_admin: 'Acalyze support', admin: 'School admin', principal: 'Principal', finance: 'Finance officer', teacher: 'Teacher', parent: 'Parent' };

function detail(e) {
  const d = e.detail || {};
  const bits = [d.name, d.title, d.receipt && `receipt ${d.receipt}`, d.student, d.amount != null && `KSh ${Math.round(d.amount).toLocaleString('en-KE')}`, d.email, d.kind && `type: ${d.kind}`, d.to && `now: ${d.to.kind}${d.to.active === false ? ', switched off' : ''}`, d.note, d.changed && `changed: ${d.changed.join(', ')}`].filter(Boolean);
  return bits.join(' · ');
}
const when = (t) => new Date(t).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export async function audit(el, ctx) {
  let area = '';
  const draw = async () => {
    const r = await api(`/audit${area ? `?area=${area}` : ''}`);
    $('#rows', el).innerHTML = table(['When', 'Who', 'What', 'Details'], r.events.map((e) => [esc(when(e.created_at)), `<b>${esc(e.actor_name || WHO[e.actor_role] || '—')}</b><div class="sm mut">${esc(WHO[e.actor_role] || '')}</div>`,
      `${pill(...(AREA[e.area] || [e.area, '']))} ${esc(WHAT[e.action] || e.action)}`, esc(detail(e))]), { empty: 'Nothing recorded yet.' });
    $('#flt', el).innerHTML = `<option value="">Everything</option>${r.areas.map((a) => `<option value="${a}" ${a === area ? 'selected' : ''}>${esc(AREA[a]?.[0] || a)}</option>`).join('')}`;
  };
  el.innerHTML = `${ctx.bar('Audit log', 'Who did what, and when', '<select class="i" id="flt" style="width:auto"></select>')}<div class="card pad0" id="rows"></div>
  <p class="sm mut" style="margin-top:12px">Recent activity, newest first. Money entries are visible to the principal only.</p>`;
  $('#flt', el).onchange = (e) => { area = e.target.value; draw(); };
  await draw();
}
export const views = { audit };
