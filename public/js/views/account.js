import { api, session } from '../api.js';
import { esc, $, $$, kes, fmtDate, toast, run, table, pill, modal, copy } from '../ui.js';

// ---------- Subscription ----------
const FEATURES = [['analytics', 'Grading, report cards and the admin analytics dashboard'], ['parents', 'Parent accounts: results and progress on the parent’s phone'], ['chat', 'Parent–teacher messaging'], ['sms', 'SMS alerts (coming soon)']];

async function subscription(el, ctx) {
  const { subscription: s, school } = await api('/school-settings');
  const due = s.nextDue;
  const invStatus = (i) => (i.status === 'paid' ? pill('Paid', 'ok') : i.due_date && new Date(i.due_date) < new Date() ? pill('Overdue', 'bad') : pill('Due', 'warn'));
  el.innerHTML = `${ctx.bar('Subscription', 'What your school is on, and what is due')}
  <div class="grid g2">
    <div class="card"><div class="mut sm">Current plan</div><h1 style="margin:6px 0">${esc(s.planName || 'Not set yet')}</h1>
      <div class="mut sm">${s.ratePerStudent != null ? `${kes(s.ratePerStudent)} per student, ${s.billingCycle === 'termly' ? 'billed each term' : 'billed yearly'} · ${s.activeStudents} students` : 'Acalyze will confirm your price with you.'}</div>
      ${s.estimatedAmount != null ? `<div style="margin-top:14px"><div class="mut sm">Estimated ${s.billingCycle === 'termly' ? 'per term' : 'per year'}</div><div style="font-family:var(--serif);font-size:26px">${kes(s.estimatedAmount)}</div></div>` : ''}</div>
    <div class="card" style="${due ? 'border-color:var(--gold)' : ''}"><div class="mut sm">Next payment</div>
      ${due ? `<h1 style="margin:6px 0;color:var(--gold-ink)">${kes(due.amount)}</h1><div class="mut sm">${esc(due.period_label)}${due.due_date ? ' · due ' + fmtDate(due.due_date) : ''}</div>`
        : '<h1 style="margin:6px 0">Nothing due</h1><div class="mut sm">You are all paid up.</div>'}</div></div>
  <div class="card" style="margin-top:16px"><h2 style="margin-bottom:12px">What's included</h2><div class="grid g2">${FEATURES.map(([k, l]) => `<div class="row" style="flex-wrap:nowrap;gap:10px"><span style="color:${s.features[k] ? 'var(--ok)' : 'var(--mut)'}">${s.features[k] ? '✓' : '—'}</span><span class="${s.features[k] ? '' : 'mut'}">${esc(l)}</span></div>`).join('')}</div>
    ${Object.values(s.features).includes(false) ? '<p class="sm mut" style="margin:14px 0 0">Want more included? Contact Acalyze to change your plan.</p>' : ''}</div>
  ${due && s.payment.paybill ? `<div class="card" style="margin-top:16px"><h2 style="margin-bottom:12px">How to pay (M-Pesa)</h2><div class="grid g3">
      <div><div class="mut sm">Paybill number</div><b class="secret">${esc(s.payment.paybill)}</b></div><div><div class="mut sm">Account number</div><b class="secret">${esc(s.payment.accountNumber)}</b></div><div><div class="mut sm">Amount</div><b class="secret">${Math.round(due.amount)}</b></div></div>
    <p class="sm mut" style="margin:14px 0 0">After paying, Acalyze confirms your payment and marks it paid here.</p></div>`
    : due ? '<div class="notice" style="margin-top:16px">Payment details will be shared with you by Acalyze.</div>' : ''}
  <div class="card pad0" style="margin-top:16px"><div class="card-h">Payment history</div>${table(['Period', 'Plan', 'Students', 'Amount', 'Status'], s.invoices.map((i) => [esc(i.period_label), esc(i.plan_name), i.student_count, kes(i.amount), invStatus(i)]), { empty: 'No invoices yet.' })}</div>`;
}

// ---------- Settings ----------
async function settings(el, ctx) {
  const { school } = await api('/school-settings');
  let logo = school.logoUrl || '';
  el.innerHTML = `${ctx.bar('Settings', 'How your school appears on report cards')}
  <div class="card"><div class="form-grid">
    <div><label class="f">School name</label><input class="i" value="${esc(school.name)}" disabled><div class="sm mut">To change the name, contact Acalyze.</div></div>
    <div><label class="f" for="motto">Motto</label><input class="i" id="motto" value="${esc(school.motto || '')}" placeholder="e.g. Pressing on to the mark"></div>
    <div><label class="f" for="tpl">Report card style</label><select class="i" id="tpl"><option value="classic" ${school.reportCardTemplate === 'classic' ? 'selected' : ''}>Classic form (printed)</option><option value="modern" ${school.reportCardTemplate === 'modern' ? 'selected' : ''}>Modern (on screen)</option></select></div>
    <div><label class="f" for="sch">Default grading for new classes</label><select class="i" id="sch"><option value="844" ${school.defaultGradingScheme === '844' ? 'selected' : ''}>8-4-4</option><option value="cbc" ${school.defaultGradingScheme === 'cbc' ? 'selected' : ''}>CBC</option></select></div></div>
    <div style="margin-top:16px"><label class="f">School logo (shown on the classic report card)</label>
      <div class="row"><div id="lp" style="width:64px;height:64px;border:1px dashed var(--line);border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden"></div>
      <input type="file" id="lf" accept="image/png,image/jpeg,image/svg+xml" class="sm"><button class="btn sm" id="lc">Remove</button></div><div class="sm mut">PNG or JPG under 200 KB works best.</div></div>
    <button class="btn primary" id="save" style="margin-top:18px">Save settings</button></div>`;
  const prev = () => { $('#lp', el).innerHTML = logo ? `<img src="${esc(logo)}" alt="Logo" style="max-width:100%;max-height:100%">` : '<span class="sm mut">None</span>'; };
  prev();
  $('#lf', el).onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 200 * 1024) { e.target.value = ''; return toast('That image is over 200 KB. Please use a smaller one.', 'bad'); }
    const r = new FileReader(); r.onload = () => { logo = r.result; prev(); }; r.readAsDataURL(f);
  };
  $('#lc', el).onclick = () => { logo = ''; prev(); };
  $('#save', el).onclick = (e) => run(e.currentTarget, async () => {
    await api('/school-settings', { method: 'PATCH', body: { motto: $('#motto', el).value.trim(), logoUrl: logo, reportCardTemplate: $('#tpl', el).value, defaultGradingScheme: $('#sch', el).value } });
    toast('Settings saved', 'ok');
  });
}

// ---------- Password resets (school admin: parents & teachers; platform: school admins) ----------
export async function resets(el, ctx) {
  const list = await api('/password-requests');
  const who = ctx.role === 'platform_admin' ? 'school admins' : 'parents and teachers';
  el.innerHTML = `${ctx.bar('Password resets', `People who forgot their password: ${who}`)}
  <div class="card pad0">${table(['Name', 'Account', 'Type', ctx.role === 'platform_admin' ? 'School' : 'Requested', ''], list.map((r) => [`<b>${esc(r.full_name)}</b>`, esc(r.identifier), pill(r.kind), esc(ctx.role === 'platform_admin' ? r.school_name : fmtDate(r.requested_at)), `<button class="btn sm primary" data-r="${r.id}" data-n="${esc(r.full_name)}">Set temporary password</button>`]), { empty: 'No password requests. 🎉' })}</div>
  <p class="sm mut" style="margin-top:12px">${ctx.role === 'platform_admin' ? 'Send the temporary password to the school admin.' : 'Pass the temporary password to the person (parents have no email, so tell them directly). They choose a new one when they sign in.'}</p>`;
  $$('[data-r]', el).forEach((b) => (b.onclick = () => modal(`<h3>Temporary password for ${esc(b.dataset.n)}</h3><p class="sm mut">Leave blank to generate one.</p><input class="i" id="pw" placeholder="Auto-generate"><div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Reset</button></div>`, {
    onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => {
      const r = await api(`/password-requests/${b.dataset.r}/resolve`, { method: 'POST', body: { password: $('#pw', m).value.trim() } });
      close(); modal(`<h3>Done</h3><p>Account: <span class="secret">${esc(r.identifier)}</span><br>Temporary password: <span class="secret">${esc(r.tempPassword)}</span></p>${r.emailed ? `<div class="notice ok">Also emailed to ${esc(r.emailedTo)}.</div>` : '<p class="sm mut">Give this to them directly. It is shown once.</p>'}<button class="btn primary" data-close style="margin-top:12px">Close</button>`);
      resets(el, ctx); ctx.refreshBadges?.();
    }); } })));
}

// ---------- Change my password ----------
export function passwordModal() {
  modal(`<h3>Change your password</h3><label class="f" for="a" style="margin-top:12px">Current password</label><input class="i" id="a" type="password" autocomplete="current-password">
    <label class="f" for="b" style="margin-top:12px">New password</label><input class="i" id="b" type="password" autocomplete="new-password">
    <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Save</button></div>`, {
    onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => {
      const a = $('#a', m).value, b = $('#b', m).value;
      if (b.length < 6) return toast('Use at least 6 characters.', 'bad');
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: a, newPassword: b } }); close(); toast('Password changed', 'ok');
    }); } });
}

export const views = { subscription, settings, resets };
