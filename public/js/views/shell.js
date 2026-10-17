import { api, session } from '../api.js';
import { esc, $, $$, toast, theme } from '../ui.js';

// Navigation per role. 'sec' rows are section headings.
const NAV = {
  platform_admin: [['overview', 'Overview'], ['registrations', 'Registrations', 'regs'], ['schools', 'Schools'], ['billing', 'Billing'], ['resets', 'Password resets', 'resets']],
  admin: [['overview', 'Overview'], ['analytics', 'Results & analytics'], ['watch', 'Students to watch'], ['reportcards', 'Report cards'],
    ['sec', 'Set up'], ['classes', 'Classes'], ['subjects', 'Subjects'], ['teachers', 'Teachers'], ['students', 'Students'], ['exams', 'Exams'], ['marks', 'Marks upload'], ['excel', 'Import from Excel'],
    ['sec', 'People'], ['parents', 'Parents', 'lock:parents'], ['approvals', 'Approvals', 'approvals'], ['resets', 'Password resets', 'resets'],
    ['sec', 'School life'], ['attendance', 'Attendance', 'lock:attendance'], ['fees', 'Fees', 'lock:fees'], ['calendar', 'Calendar', 'lock:calendar'],
    ['sec', 'Account'], ['subscription', 'Subscription'], ['settings', 'Settings']],
  teacher: [['marks', 'Enter marks'], ['attendance', 'Attendance'], ['myclass', 'My class results'], ['messages', 'Messages', 'unread'], ['calendar', 'Calendar']],
  parent: [['results', 'Report cards'], ['messages', 'Messages', 'unread'], ['calendar', 'Calendar']],
};
const MODULE = {
  platform_admin: () => import('./platform.js'),
  admin: () => import('./admin.js'),
  teacher: () => import('./teacher.js'),
  parent: () => import('./parent.js'),
};

export async function mountShell(app, s, viewKey) {
  const role = s.role;
  let me, features = { analytics: true, parents: true, chat: true }, badges = {};
  try {
    me = await api('/auth/me');
    if (role === 'admin') { const st = await api('/school-settings'); features = st.subscription.features; }
  } catch (e) { toast(e.message, 'bad'); session.clear(); location.hash = '#/login'; return; }

  const items = NAV[role] || [];
  const first = items.find((i) => i[0] !== 'sec')[0];
  const key = items.some((i) => i[0] === viewKey) ? viewKey : first;
  const acting = session.hasStash();

  app.innerHTML = `${acting ? `<div class="banner no-print"><span>Viewing <b>${esc(me.organization || 'a school')}</b> as Acalyze support.</span><button class="btn sm" id="exitAct">Back to platform</button></div>` : ''}
  <div class="shell"><aside class="side no-print" id="side"><div class="brand"><i></i>Acalyze</div>
    <nav class="nav" aria-label="Main">${items.map(([k, label, badge]) => k === 'sec' ? `<div class="sec">${esc(label)}</div>`
      : `<a href="#/app/${k}" data-k="${k}" class="${k === key ? 'on' : ''}"><span>${esc(label)}${badge?.startsWith('lock:') && features[badge.slice(5)] === false ? ' 🔒' : ''}</span><span class="badge hide" data-badge="${badge?.startsWith('lock:') ? '' : badge || ''}"></span></a>`).join('')}</nav>
    <div class="side-foot"><b>${esc(me.name || '')}</b>${esc(me.organization || me.roleLabel || '')}
      <div class="row" style="margin-top:10px"><button class="btn sm" id="themeBtn">${theme.isDark() ? '☀ Light' : '☾ Dark'}</button><button class="btn sm" id="pwBtn">Password</button><button class="btn sm" id="out">Sign out</button></div></div></aside>
    <main class="main" id="main" tabindex="-1"></main></div>`;

  $('#themeBtn', app).onclick = (e) => { theme.toggle(); e.currentTarget.textContent = theme.isDark() ? '☀ Light' : '☾ Dark'; };
  $('#out', app).onclick = () => { session.clear(); location.hash = '#/login'; };
  $('#exitAct', app)?.addEventListener('click', () => { session.restore(); location.hash = '#/app'; location.reload(); });
  $('#pwBtn', app).onclick = () => import('./account.js').then((m) => m.passwordModal());
  const menu = () => $('#side', app).classList.toggle('open');
  app.addEventListener('click', (e) => { if (e.target.closest('[data-menu]')) menu(); else if (e.target.closest('.nav a')) $('#side', app).classList.remove('open'); });

  const ctx = { me, role, features, key,
    async refreshBadges() { await updateBadges(app, role, features); },
    go(k) { location.hash = `#/app/${k}`; } };
  const el = $('#main', app);
  const bar = (title, sub = '', actions = '') => `<div class="topbar no-print"><div class="row" style="gap:10px;align-items:flex-start"><button class="btn sm menu-btn" data-menu aria-label="Open menu">☰</button><div><h1>${esc(title)}</h1>${sub ? `<div class="mut sm" style="margin-top:3px">${esc(sub)}</div>` : ''}</div></div><div class="row">${actions}</div></div>`;
  ctx.bar = bar;

  el.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const mod = await MODULE[role]();
    const view = mod.views[key];
    el.classList.remove('fade'); void el.offsetWidth; el.classList.add('fade');
    await view(el, ctx);
  } catch (e) { console.error(e); el.innerHTML = `${bar('Something went wrong')}<div class="notice bad">${esc(e.message)}</div>`; }
  updateBadges(app, role, features);
}

async function updateBadges(app, role, features) {
  const set = (name, n) => $$(`[data-badge="${name}"]`, app).forEach((b) => { b.textContent = n; b.classList.toggle('hide', !n); });
  try {
    if (role === 'admin') {
      const [ov] = await Promise.all([api('/analytics/overview')]);
      set('approvals', ov.pending.edits); set('resets', ov.pending.passwords);
    } else if (role === 'platform_admin') {
      const [regs, pw] = await Promise.all([api('/organizations/registrations?status=pending'), api('/password-requests')]);
      set('regs', regs.length); set('resets', pw.length);
    }
    if ((role === 'teacher' || role === 'parent') && features.chat !== false) {
      const u = await api('/chat/unread').catch(() => null); if (u) set('unread', u.unread);
    }
  } catch { /* badges are a nicety, never block the page */ }
}
