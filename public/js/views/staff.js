import { api } from '../api.js';
import { esc, $, $$, toast, modal, run, pill, table, fmtDate } from '../ui.js';

// Staff accounts for the school: school admins and deputies, the principal, finance officers.
// (Teachers and parents are managed on their own screens.)
const KIND_HELP = {
  admin: 'School admin or deputy: runs the school day to day. Cannot see finance.',
  principal: 'Principal, head teacher or owner: sees the whole school and approves finance. Cannot edit academics.',
  finance: 'Finance officer (bursar): fees and money only. Sees no academic records.',
};

export async function staff(el, ctx) {
  const { me, kinds, staff: list } = await api('/staff');
  el.innerHTML = `${ctx.bar('Staff accounts', 'School admins, deputies, the principal and finance officers', '<button class="btn primary" id="add">+ Add staff account</button>')}
  <div class="card pad0">${table(['Name', 'Sign-in email', 'Account', 'Status', ''], list.map((s) => [
    `<b>${esc(s.full_name)}</b>${s.title ? `<div class="sm mut">${esc(s.title)}</div>` : ''}`, esc(s.email), pill(kinds[s.role_kind] || s.role_kind, s.role_kind === 'finance' ? 'warn' : ''),
    s.active ? (s.must_change_password ? pill('Has not signed in yet', 'warn') : pill('Active', 'ok')) : pill('Switched off', 'bad'),
    `<div class="row" style="gap:6px"><button class="btn sm" data-edit="${s.id}">Edit</button>${s.id === me ? '' : `<button class="btn sm" data-pw="${s.id}">Reset password</button>`}</div>`]))}</div>
  <p class="sm mut" style="margin-top:12px">A new person signs in with the email and temporary password you give them, then chooses their own password. Accounts are switched off, never deleted, so past records keep their author.</p>`;

  const kindOptions = (sel) => Object.keys(KIND_HELP).map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(kinds[k] || k)}</option>`).join('');
  const secret = (t, r) => modal(`<h3>${esc(t)}</h3><p>Sign-in email: <span class="secret">${esc(r.email)}</span><br>Temporary password: <span class="secret">${esc(r.tempPassword)}</span></p><p class="sm mut">Give these to them directly. The password is shown once, and they must choose a new one when they first sign in.</p><div class="row" style="justify-content:flex-end"><button class="btn primary" data-close>Done</button></div>`);

  $('#add', el).onclick = () => modal(`<h3>Add a staff account</h3>
    <label class="f" for="fn" style="margin-top:12px">Full name</label><input class="i" id="fn">
    <label class="f" for="em" style="margin-top:12px">Email (they sign in with this)</label><input class="i" id="em" type="email" autocomplete="off">
    <label class="f" for="kd" style="margin-top:12px">Account type</label><select class="i" id="kd">${kindOptions('admin')}</select><p class="sm mut" id="kh" style="margin:6px 0 0"></p>
    <label class="f" for="tt" style="margin-top:12px">Title (optional, e.g. Deputy Principal, Bursar)</label><input class="i" id="tt" maxlength="60">
    <label class="f" for="pw" style="margin-top:12px">Temporary password (optional)</label><input class="i" id="pw" placeholder="Leave empty to make one" autocomplete="off">
    <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Create account</button></div>`, {
    onMount: (m, close) => {
      const help = () => ($('#kh', m).textContent = KIND_HELP[$('#kd', m).value]); help(); $('#kd', m).onchange = help;
      $('#go', m).onclick = (e) => run(e.currentTarget, async () => {
        const r = await api('/staff', { method: 'POST', body: { fullName: $('#fn', m).value, email: $('#em', m).value, kind: $('#kd', m).value, title: $('#tt', m).value, password: $('#pw', m).value.trim() } });
        close(); secret('Account created', r); staff(el, ctx);
      });
    } });

  $$('[data-edit]', el).forEach((b) => (b.onclick = () => {
    const s = list.find((x) => x.id === b.dataset.edit), self = s.id === me;
    modal(`<h3>Edit ${esc(s.full_name)}</h3>
      <label class="f" for="fn" style="margin-top:12px">Full name</label><input class="i" id="fn" value="${esc(s.full_name)}">
      <label class="f" for="tt" style="margin-top:12px">Title</label><input class="i" id="tt" value="${esc(s.title || '')}" maxlength="60">
      <label class="f" for="kd" style="margin-top:12px">Account type</label><select class="i" id="kd" ${self ? 'disabled' : ''}>${kindOptions(s.role_kind)}</select>
      <label class="f" for="ac" style="margin-top:12px">Status</label><select class="i" id="ac" ${self ? 'disabled' : ''}><option value="1" ${s.active ? 'selected' : ''}>Active</option><option value="0" ${s.active ? '' : 'selected'}>Switched off (cannot sign in)</option></select>
      ${self ? '<p class="sm mut" style="margin-top:8px">You cannot change your own account type or switch yourself off.</p>' : ''}
      <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Save</button></div>`, {
      onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => {
        const body = { fullName: $('#fn', m).value, title: $('#tt', m).value };
        if (!self) { body.kind = $('#kd', m).value; body.active = $('#ac', m).value === '1'; }
        await api(`/staff/${s.id}`, { method: 'PATCH', body }); close(); toast('Saved', 'ok'); staff(el, ctx);
      }); } });
  }));

  $$('[data-pw]', el).forEach((b) => (b.onclick = () => {
    const s = list.find((x) => x.id === b.dataset.pw);
    modal(`<h3>Reset password for ${esc(s.full_name)}</h3><p class="sm mut">They will be signed out everywhere and must choose a new password at their next sign-in.</p>
      <input class="i" id="pw" placeholder="Leave empty to make a temporary password" autocomplete="off">
      <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Reset password</button></div>`, {
      onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => {
        const r = await api(`/staff/${s.id}/reset-password`, { method: 'POST', body: { password: $('#pw', m).value.trim() } });
        close(); secret('Password reset', r); staff(el, ctx);
      }); } });
  }));
}
export const views = { staff };
