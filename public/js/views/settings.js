import { session } from '../api.js';
import { esc, $, $$, theme, initials, toast, BAND_CUTS, BAND_LABELS } from '../ui.js';
import { installApp, isInstalled } from '../install.js';
import * as account from './account.js';

// One Settings page for everyone. "My account" is about you; "School" is for the school admin only.
async function settings(el, ctx) {
  const isAdmin = ctx.role === 'admin';
  let tab = 'me';
  const draw = () => {
    el.innerHTML = `${ctx.bar('Settings', isAdmin ? 'Your account and your school' : 'Your account')}
    ${isAdmin ? `<div class="tabs"><button class="tab ${tab === 'me' ? 'on' : ''}" data-t="me">My account</button><button class="tab ${tab === 'school' ? 'on' : ''}" data-t="school">School</button></div>` : ''}<div id="pane"></div>`;
    $$('.tab', el).forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    (tab === 'me' ? mine : school)($('#pane', el));
  };

  function mine(pane) {
    const me = ctx.me, sup = me.support || {}, dark = theme.isDark();
    pane.innerHTML = `<div class="grid set2">
      <div class="card"><h2>Profile</h2><div class="row" style="margin:14px 0;flex-wrap:nowrap;gap:14px"><div class="avatar-lg">${esc(initials(me.name))}</div><div><div class="b" style="font-size:16px">${esc(me.name || '')}</div><div class="mut sm">${esc([me.roleLabel, me.organization].filter(Boolean).join(' · '))}</div></div></div></div>
      <div class="card"><h2>Appearance</h2><div class="line"><span>Theme</span><div class="seg" role="group" aria-label="Theme"><button data-th="light" class="${dark ? '' : 'on'}">Light</button><button data-th="dark" class="${dark ? 'on' : ''}">Dark</button></div></div></div>
      <div class="card"><h2>Security</h2><div class="line"><span>Password</span><button class="btn sm" id="pw">Change password</button></div><div class="line"><span class="mut sm">Lost a phone or used a shared computer? Open “Change password” and choose “Sign out of all other devices”.</span></div></div>
      <div class="card"><h2>App and help</h2>${isInstalled() ? '' : '<div class="line"><span>Install Acalyze on this device</span><button class="btn sm primary" id="inst">Install app</button></div>'}
        ${sup.phone || sup.email ? `<div class="line"><span>${esc(sup.title || 'Need help?')}</span><span class="sm">${[sup.phone, sup.email].filter(Boolean).map(esc).join(' · ')}</span></div>` : ''}
        <div class="line"><span class="b" style="color:var(--bad)">Sign out</span><button class="btn sm" id="out">Sign out</button></div></div></div>`;
    $$('[data-th]', pane).forEach((b) => (b.onclick = () => { if ((b.dataset.th === 'dark') !== theme.isDark()) theme.toggle(); mine(pane); }));
    $('#pw', pane).onclick = () => account.passwordModal();
    $('#inst', pane)?.addEventListener('click', installApp);
    $('#out', pane).onclick = () => { session.clear(); location.hash = '#/login'; };
  }

  async function school(pane) {
    const rows = [[5, `${BAND_CUTS[0]}% and above`], [4, `${BAND_CUTS[1]}% to ${BAND_CUTS[0] - 1}%`], [3, `${BAND_CUTS[2]}% to ${BAND_CUTS[1] - 1}%`], [2, `${BAND_CUTS[3]}% to ${BAND_CUTS[2] - 1}%`], [1, `Below ${BAND_CUTS[3]}%`]];
    pane.innerHTML = `<div id="sch"></div>
      <div class="grid set2" style="margin-top:18px">
        <div class="card"><h2>Plan and records</h2><div class="line"><span>Subscription and payments</span><a class="btn sm" href="#/app/subscription">Open</a></div><div class="line"><span>Audit log</span><a class="btn sm" href="#/app/audit">Open</a></div><div class="line"><span>Staff accounts</span><a class="btn sm" href="#/app/staff">Manage</a></div></div>
        <div class="card"><h2>Performance colours</h2><p class="sm mut" style="margin:4px 0 8px">The same scale is used for marks, attendance and fees, with the level written next to each colour.</p>${rows.map(([b, r]) => `<div class="line"><span>${esc(r)}</span><span class="pill b${b}">${BAND_LABELS[b]}</span></div>`).join('')}</div></div>`;
    // the existing school form, shown here without its own page heading
    try { await account.views.settings($('#sch', pane), { ...ctx, bar: () => '' }); }
    catch (e) { $('#sch', pane).innerHTML = `<div class="notice bad">Could not load the school form: ${esc(e.message)}</div>`; }
  }
  draw();
}

export const views = { settings };
