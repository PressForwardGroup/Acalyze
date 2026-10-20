import { api, session } from '../api.js';
import { esc, $, $$, kes, fmtDate, toast, run, table, stat, pill, modal, confirmBox, copy, barChart, hbarChart, lineChart, donut, color } from '../ui.js';
import { resets } from './account.js';

const PLAN_INFO = {
  'Analytics': { suggest: 150, has: ['Grading & report cards', 'Admin analytics dashboard', 'Excel import, early-warning list, school calendar'] },
  'Analytics + Parents': { suggest: 250, has: ['Everything in Analytics', 'Parent accounts & report cards', 'Attendance registers (parents see their child’s)'] },
  'Full Suite': { suggest: 400, has: ['Everything in Analytics + Parents', 'Parent–teacher messaging', 'School fees, payments and receipts', 'SMS alerts (when set up)'] },
  'Custom': { suggest: '', has: ['Everything included. You set the price.'] },
};
const statusPill = (s) => (s === 'active' ? pill('Active', 'ok') : s === 'suspended' ? pill('Suspended', 'bad') : pill(s, 'warn'));
const invPill = (s) => (!s ? '<span class="mut">—</span>' : s === 'paid' ? pill('Paid', 'ok') : s === 'overdue' ? pill('Overdue', 'bad') : pill('Pending', 'warn'));

// ---------- Overview ----------
async function overview(el, ctx) {
  const [s, orgs] = await Promise.all([api('/organizations/stats/summary'), api('/organizations')]);
  const t = s.totals;
  let cum = 0; const growth = s.growth.map((g) => ({ label: g.month, v: (cum += g.schools) }));
  const money = Object.fromEntries(s.invoices.map((i) => [i.status, i]));
  el.innerHTML = `${ctx.bar('Platform overview', 'Every school on Acalyze')}
  <div class="grid g4 fade">${stat('Active schools', t.active_schools, { tone: 'green', sub: t.suspended_schools ? `${t.suspended_schools} suspended` : '' })}${stat('Students', t.students.toLocaleString(), { tone: 'navy' })}${stat('Teachers & parents', `${t.teachers.toLocaleString()} · ${t.parents.toLocaleString()}`, { tone: 'gold' })}${stat('Billing estimate (per cycle)', kes(t.estimated_billing), { tone: 'red', sub: 'rate × students, all schools' })}</div>
  ${s.pendingRegistrations ? `<div class="notice" style="margin-top:16px"><b>${s.pendingRegistrations}</b> school${s.pendingRegistrations > 1 ? 's are' : ' is'} waiting for approval. <a href="#/app/registrations"><b>Review now</b></a></div>` : ''}
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h2 style="margin-bottom:10px">Schools over time</h2>${growth.length ? lineChart(growth.map((g) => g.label), [{ name: 'Schools', values: growth.map((g) => g.v) }], { title: 'Total schools by month' }) : '<div class="empty">No schools yet.</div>'}</div>
    <div class="card"><h2 style="margin-bottom:10px">Biggest schools (students)</h2>${hbarChart(s.topSchools.map((x) => ({ label: x.name, value: x.students })), { title: 'Students per school' })}</div></div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h2 style="margin-bottom:10px">Schools by plan</h2>${donut(s.byPlan.map((p) => ({ label: p.plan, value: p.schools })), { title: 'Schools by plan' })}</div>
    <div class="card"><h2 style="margin-bottom:10px">Invoices</h2>${['paid', 'pending', 'overdue'].some((k) => money[k]) ? barChart(['paid', 'pending', 'overdue'].map((k, i) => ({ label: k, value: Math.round(money[k]?.total || 0), color: ['var(--c3)', 'var(--c2)', 'var(--c5)'][i] })), { title: 'Invoice totals by status', height: 190 }) + `<div class="legend" style="margin-top:6px">${['paid', 'pending', 'overdue'].map((k) => `<span>${k}: ${kes(money[k]?.total || 0)} (${money[k]?.n || 0})</span>`).join('')}</div>` : '<div class="empty">No invoices yet. Create one from the Schools page.</div>'}</div></div>`;
}

// ---------- Registrations ----------
async function registrations(el, ctx) {
  let tab = 'pending';
  const draw = async () => {
    const list = await api(`/organizations/registrations?status=${tab}`);
    $('#list', el).innerHTML = list.length ? list.map((r) => `<div class="card" style="margin-bottom:12px"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><h2>${esc(r.school_name)}</h2>
      <div class="mut sm">${esc(r.location || 'Location not given')} · ${esc(r.system_used || '—')} · about ${r.approx_students ? r.approx_students.toLocaleString() : '?'} students</div>
      <div class="sm" style="margin-top:6px">${esc(r.contact_name || '')} · <a href="mailto:${esc(r.contact_email)}">${esc(r.contact_email)}</a>${r.contact_phone ? ' · ' + esc(r.contact_phone) : ''}</div><div class="mut sm">Submitted ${fmtDate(r.submitted_at)}</div></div>
      ${tab === 'pending' ? `<div class="row"><button class="btn primary" data-ok="${r.id}">Approve & set up</button><button class="btn danger" data-no="${r.id}">Reject</button></div>` : pill(r.status, r.status === 'approved' ? 'ok' : 'bad')}</div></div>`).join('') : '<div class="card empty">Nothing here.</div>';
    $$('[data-ok]', el).forEach((b) => (b.onclick = () => {
      const reg = list.find((x) => x.id === b.dataset.ok);
      const form = modal(`<h3>Set up ${esc(reg.school_name)}</h3><p class="sm mut">Choose how the school's admin signs in. The email starts as the school's own; change it if you want.</p>
        <label class="f" for="ae">Login email</label><input class="i" id="ae" type="email" value="${esc(reg.contact_email || '')}" autocomplete="off">
        <label class="f" for="ap" style="margin-top:12px">Password</label><input class="i" id="ap" type="text" placeholder="Type one (8+ characters with a letter and a number), or leave empty for a random one" autocomplete="off">
        <div class="row" style="margin-top:18px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Approve &amp; set up</button></div>`);
      $('#go', form.el).onclick = (e) => run(e.currentTarget, async () => {
      const r = await api(`/organizations/registrations/${b.dataset.ok}/approve`, { method: 'POST', body: { adminEmail: $('#ae', form.el).value.trim(), adminPassword: $('#ap', form.el).value } });
      form.close();
      const msg = `Welcome to Acalyze! Your school workspace is ready.\nSign in at ${location.origin}/app/\nEmail: ${r.adminLogin.email}\nTemporary password: ${r.adminLogin.password}\nPlease change your password after signing in.`;
      modal(`<h3>${esc(r.organization.name)} is set up</h3>${r.emailed ? `<div class="notice ok">The sign-in details were emailed to ${esc(r.emailedTo)}.</div>` : ''}<p class="sm mut">${r.emailed ? 'You can also copy them here.' : 'Send these sign-in details to the school.'} The password is shown only once.</p><textarea class="i" readonly style="min-height:130px">${esc(msg)}</textarea>
        <div class="row" style="margin-top:14px;justify-content:space-between"><button class="btn" id="cp">Copy message</button><a class="btn primary" href="#/app/schools" data-close>Go to schools</a></div>`, { onMount: (m) => { $('#cp', m).onclick = () => copy(msg); } });
      draw(); ctx.refreshBadges();
      });
    }));
    $$('[data-no]', el).forEach((b) => (b.onclick = async () => { if (await confirmBox('Reject this registration?', 'Reject')) run(b, async () => { await api(`/organizations/registrations/${b.dataset.no}/reject`, { method: 'POST' }); draw(); ctx.refreshBadges(); }); }));
  };
  el.innerHTML = `${ctx.bar('Registrations', 'Schools asking to join Acalyze')}<div class="tabs">${['pending', 'approved', 'rejected'].map((t) => `<button class="tab ${t === tab ? 'on' : ''}" data-t="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div><div id="list"></div>`;
  $$('.tab', el).forEach((b) => (b.onclick = () => { tab = b.dataset.t; $$('.tab', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  await draw();
}

// ---------- modules: what this school gets ----------
async function modulesModal(o, done) {
  const cur = await api(`/organizations/${o.id}/modules`);
  const groups = [...new Set(cur.catalog.map((m) => m.group))];
  modal(`<h3>Modules for ${esc(o.name)}</h3><p class="sm mut">Choose exactly what this school gets, or let its plan decide. A school never sees a module that is switched off.</p>
    <label class="row" style="gap:8px;margin:12px 0"><input type="checkbox" id="cu" ${cur.custom ? 'checked' : ''}><span><b>Choose modules myself</b> (otherwise the school follows its plan)</span></label>
    ${groups.map((g) => `<div style="margin-top:10px"><b>${esc(g)}</b></div>${cur.catalog.filter((m) => m.group === g).map((m) => `<label class="row" style="gap:8px;padding:4px 0"><input type="checkbox" data-m="${m.key}" ${cur.modules[m.key] ? 'checked' : ''}> ${esc(m.label)}${m.soon ? ' <span class="mut sm">(coming soon)</span>' : ''}</label>`).join('')}`).join('')}
    <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Save</button></div>`, {
    onMount: (m, close) => {
      const sync = () => $$('[data-m]', m).forEach((c) => (c.disabled = !$('#cu', m).checked)); sync(); $('#cu', m).onchange = sync;
      $('#go', m).onclick = (e) => run(e.currentTarget, async () => {
        const modules = $('#cu', m).checked ? Object.fromEntries($$('[data-m]', m).map((c) => [c.dataset.m, c.checked])) : null;
        await api(`/organizations/${o.id}/modules`, { method: 'PATCH', body: { modules } }); close(); toast('Modules saved', 'ok'); done?.();
      });
    } });
}

// ---------- shared: plan modal & invoices modal ----------
function planModal(o, done) {
  const cur = o.plan_name || 'Analytics + Parents';
  modal(`<h3>Plan for ${esc(o.name)}</h3><p class="sm mut">${o.student_count} students at the moment. Set the price you agreed with this school.</p>
    <label class="f" for="pn" style="margin-top:12px">Plan</label><select class="i" id="pn">${Object.keys(PLAN_INFO).map((p) => `<option ${p === cur ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
    <ul id="has" class="sm mut" style="margin:10px 0"></ul>
    <div class="form-grid"><div><label class="f" for="rt">Price per student (KSh)</label><input class="i" id="rt" type="number" min="0" step="1" value="${o.rate_per_student ?? ''}"></div>
      <div><label class="f" for="cy">Billed</label><select class="i" id="cy"><option value="annual" ${o.billing_cycle === 'annual' ? 'selected' : ''}>Once a year</option><option value="termly" ${o.billing_cycle === 'termly' ? 'selected' : ''}>Every term</option></select></div></div>
    <div id="est" class="b" style="margin-top:12px"></div>
    <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Save plan</button></div>`, {
    onMount: (m, close) => {
      const upd = () => { const p = $('#pn', m).value; $('#has', m).innerHTML = PLAN_INFO[p].has.map((x) => `<li>${esc(x)}</li>`).join(''); const r = +$('#rt', m).value; $('#est', m).textContent = r ? `≈ ${kes(r * o.student_count)} ${$('#cy', m).value === 'termly' ? 'per term' : 'per year'}` : ''; };
      $('#pn', m).onchange = () => { if (!o.rate_per_student && !$('#rt', m).value) $('#rt', m).value = PLAN_INFO[$('#pn', m).value].suggest; upd(); };
      $('#rt', m).oninput = upd; $('#cy', m).onchange = upd; upd();
      $('#go', m).onclick = (e) => run(e.currentTarget, async () => {
        if ($('#rt', m).value === '') return toast('Enter the price per student.', 'bad');
        await api(`/organizations/${o.id}/plan`, { method: 'PATCH', body: { planName: $('#pn', m).value, ratePerStudent: +$('#rt', m).value, billingCycle: $('#cy', m).value } });
        close(); toast('Plan saved', 'ok'); done();
      });
    } });
}

async function invoicesModal(o, done) {
  const render = async (m) => {
    const inv = await api(`/organizations/${o.id}/invoices`);
    $('#body', m).innerHTML = `${table(['Period', 'Students', 'Amount', 'Due', 'Status', ''], inv.map((i) => [esc(i.period_label), i.student_count, `<b>${kes(i.amount)}</b>`, fmtDate(i.due_date), invPill(i.status === 'pending' && i.due_date && new Date(i.due_date) < new Date() ? 'overdue' : i.status), i.status === 'paid' ? `<span class="mut sm">${fmtDate(i.paid_at)}</span>` : `<button class="btn sm primary" data-paid="${i.id}">Mark paid</button>`]), { empty: 'No invoices yet.' })}`;
    $$('[data-paid]', m).forEach((b) => (b.onclick = () => run(b, async () => { await api(`/organizations/invoices/${b.dataset.paid}/paid`, { method: 'PATCH' }); toast('Marked as paid', 'ok'); render(m); done(); })));
  };
  modal(`<h3>Invoices: ${esc(o.name)}</h3>
    ${o.plan_name && o.rate_per_student != null ? `<div class="form-grid" style="margin:12px 0"><div><label class="f" for="pl">Period</label><input class="i" id="pl" value="${new Date().getFullYear()}" placeholder="2027 or Term 1 2027"></div><div><label class="f" for="dd">Due date</label><input class="i" id="dd" type="date"></div></div>
      <button class="btn primary" id="mk">Create invoice from plan (${kes(o.rate_per_student)} × current students)</button>` : '<div class="notice" style="margin:12px 0">Set this school\'s plan and price first, then you can invoice them.</div>'}
    <div id="body" style="margin-top:16px;max-height:40vh;overflow:auto"></div><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-close>Close</button></div>`, {
    onMount: (m) => { render(m); $('#mk', m)?.addEventListener('click', (e) => run(e.currentTarget, async () => { await api(`/organizations/${o.id}/invoices`, { method: 'POST', body: { periodLabel: $('#pl', m).value.trim(), dueDate: $('#dd', m).value || undefined } }); toast('Invoice created', 'ok'); render(m); done(); })); } });
}

function viewSchool(o) {
  return run(null, async () => {
    const r = await api('/auth/platform/view-org', { method: 'POST', body: { organizationId: o.id } });
    session.stash(); session.set({ token: r.token, role: 'admin', name: 'Acalyze support' });
    location.hash = '#/app'; location.reload();
  });
}

// ---------- Schools ----------
async function schools(el, ctx) {
  const list = await api('/organizations');
  el.innerHTML = `${ctx.bar('Schools', `${list.length} on the platform`)}
  <div class="card pad0">${table(['School', 'Students', 'Plan', 'Price / student', 'Status', 'Latest invoice', ''], list.map((o) => [`<b>${esc(o.name)}</b><div class="sm mut">${esc(o.slug)} · code ${esc(o.org_code)}</div>`, o.student_count.toLocaleString(), o.plan_name ? esc(o.plan_name) : pill('Not set', 'warn'), o.rate_per_student != null ? kes(o.rate_per_student) : '—', statusPill(o.status), invPill(o.latest_invoice_status),
    `<div class="row" style="gap:6px"><button class="btn sm" data-plan="${o.id}">Plan & price</button><button class="btn sm" data-mod="${o.id}">Modules</button><button class="btn sm" data-inv="${o.id}">Invoices</button><button class="btn sm" data-view="${o.id}">Open school</button><button class="btn sm ${o.status === 'active' ? 'danger' : ''}" data-st="${o.id}">${o.status === 'active' ? 'Suspend' : 'Activate'}</button></div>`]), { empty: 'No schools yet. Approve a registration to add the first one.' })}</div>`;
  const by = (id) => list.find((x) => x.id === id), refresh = () => schools(el, ctx);
  $$('[data-plan]', el).forEach((b) => (b.onclick = () => planModal(by(b.dataset.plan), refresh)));
  $$('[data-mod]', el).forEach((b) => (b.onclick = () => modulesModal(by(b.dataset.mod), refresh)));
  $$('[data-inv]', el).forEach((b) => (b.onclick = () => invoicesModal(by(b.dataset.inv), refresh)));
  $$('[data-view]', el).forEach((b) => (b.onclick = () => viewSchool(by(b.dataset.view))));
  $$('[data-st]', el).forEach((b) => (b.onclick = async () => {
    const o = by(b.dataset.st), to = o.status === 'active' ? 'suspended' : 'active';
    if (await confirmBox(to === 'suspended' ? `Suspend ${o.name}? Nobody at the school will be able to sign in or use Acalyze until you reactivate it.` : `Reactivate ${o.name}?`, to === 'suspended' ? 'Suspend' : 'Reactivate'))
      run(b, async () => { await api(`/organizations/${o.id}/status`, { method: 'PATCH', body: { status: to } }); toast(to === 'suspended' ? 'School suspended' : 'School reactivated', 'ok'); refresh(); });
  }));
}

// ---------- Billing ----------
async function billing(el, ctx) {
  const [s, list] = await Promise.all([api('/organizations/stats/summary'), api('/organizations')]);
  const active = list.filter((o) => o.status === 'active');
  const est = (o) => (o.rate_per_student != null ? Number(o.rate_per_student) * o.student_count : null);
  el.innerHTML = `${ctx.bar('Billing', 'What each school pays, and what has been collected')}
  <div class="card" style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:center"><div><div class="b">Where payments land</div><div class="sm mut">One M-Pesa Paybill for the whole platform. Each school pays with its own code as the account number.</div></div>
    <div class="row sm" style="gap:24px"><div><span class="mut">Paybill</span> <b class="secret">${s.paybill ? esc(s.paybill) : 'not set (add PAYBILL_NUMBER to your server settings)'}</b></div></div></div>
  <div class="grid g3" style="margin-top:16px">${stat('Estimated per billing cycle', kes(s.totals.estimated_billing), { tone: 'navy' })}${stat('Collected', kes(s.invoices.find((i) => i.status === 'paid')?.total || 0), { tone: 'green' })}${stat('Waiting to be paid', kes((s.invoices.find((i) => i.status === 'pending')?.total || 0) + (s.invoices.find((i) => i.status === 'overdue')?.total || 0), { tone: 'red' }))}</div>
  <div class="card pad0" style="margin-top:16px">${table(['School', 'Account no.', 'Plan', 'Price', 'Students', 'Estimated', 'Billed', 'Latest invoice', ''], active.map((o) => [`<b>${esc(o.name)}</b>`, `<span class="secret">${esc(o.org_code)}</span>`, o.plan_name ? esc(o.plan_name) : pill('Not set', 'warn'), o.rate_per_student != null ? kes(o.rate_per_student) : '—', o.student_count.toLocaleString(), est(o) != null ? `<b>${kes(est(o))}</b>` : '—', o.billing_cycle === 'termly' ? 'Each term' : 'Yearly', invPill(o.latest_invoice_status), `<div class="row" style="gap:6px"><button class="btn sm" data-plan="${o.id}">Price</button><button class="btn sm primary" data-inv="${o.id}">Invoices</button></div>`]), { empty: 'No active schools yet.' })}</div>
  <p class="sm mut" style="margin-top:12px">Payments are confirmed by hand for now: check the M-Pesa message, then press "Mark paid" on the invoice.</p>`;
  const by = (id) => list.find((x) => x.id === id), refresh = () => billing(el, ctx);
  $$('[data-plan]', el).forEach((b) => (b.onclick = () => planModal(by(b.dataset.plan), refresh)));
  $$('[data-inv]', el).forEach((b) => (b.onclick = () => invoicesModal(by(b.dataset.inv), refresh)));
}

// ---------- bookings (demo / meeting requests from the website) ----------
const KIND = { in_person: '🤝 Face to face', video: '🎥 Google Meet', phone: '📞 Phone call' };
const whenText = (d) => new Date(d).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' EAT';

async function bookings(el, ctx) {
  let tab = 'new';
  const draw = async () => {
    const list = await api(`/bookings?view=${tab}`);
    const box = $('#list', el);
    if (!list.length) { box.innerHTML = `<div class="card"><p class="mut" style="margin:0">${tab === 'new' ? 'No new requests right now.' : tab === 'upcoming' ? 'No confirmed meetings coming up.' : 'Nothing here yet.'}</p></div>`; return; }
    box.innerHTML = list.map((b) => `<div class="card" style="margin-bottom:12px"><div class="row" style="justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div><div class="b">${esc(b.name)}${b.school ? ` <span class="mut">· ${esc(b.school)}</span>` : ''}</div>
        <div style="margin-top:4px">${KIND[b.kind] || esc(b.kind)} · <b>${esc(whenText(b.starts_at))}</b>${tab === 'history' ? ` <span class="mut">(${esc(b.status)})</span>` : ''}</div></div>
        <div class="row">${tab === 'new' ? `<button class="btn primary sm" data-st="confirmed" data-id="${b.id}">Confirm</button><button class="btn sm" data-st="declined" data-id="${b.id}">Decline</button>` : ''}${tab === 'upcoming' ? `<button class="btn sm" data-st="done" data-id="${b.id}">Mark done</button><button class="btn sm" data-st="cancelled" data-id="${b.id}">Cancel</button>` : ''}</div></div>
      <p class="sm" style="margin:10px 0 0"><a href="mailto:${esc(b.email)}">${esc(b.email)}</a>${b.phone ? ` · <a href="tel:${esc(String(b.phone).replace(/[^\d+]/g, ''))}">${esc(b.phone)}</a>` : ''}</p>
      ${b.message ? `<p class="mut" style="margin:8px 0 0">${esc(b.message)}</p>` : ''}</div>`).join('');
    $$('[data-st]', box).forEach((btn) => (btn.onclick = () => run(btn, async () => {
      await api(`/bookings/${btn.dataset.id}`, { method: 'PATCH', body: { status: btn.dataset.st } });
      toast(btn.dataset.st === 'confirmed' ? 'Confirmed. The person has been emailed.' : 'Updated.', 'ok');
      await draw(); ctx.refreshBadges();
    })));
  };
  el.innerHTML = `${ctx.bar('Bookings', 'Demo and meeting requests from the website')}<div class="tabs">${[['new', 'New'], ['upcoming', 'Upcoming'], ['history', 'History']].map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div><div id="list"></div>`;
  $$('.tab', el).forEach((b) => (b.onclick = () => { tab = b.dataset.t; $$('.tab', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  await draw();
}

export const views = { overview, registrations, bookings, schools, billing, resets };
