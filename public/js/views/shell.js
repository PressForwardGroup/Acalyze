import { api, session } from '../api.js';
import { esc, $, $$, toast, theme, initials, modal, recent } from '../ui.js';
import { installApp, isInstalled } from '../install.js';

// Navigation per role. A plain row is a link: [key, label, badge]. { g, items } is a drop-down group.
// Account things (profile, theme, password, sign out) live in Settings and the avatar menu, not here.
const G = (g, items) => ({ g, items });
const NAV = {
  platform_admin: [['overview', 'Home'], ['registrations', 'Registrations', 'regs'], ['bookings', 'Bookings', 'bookings'], ['schools', 'Schools'], ['billing', 'Billing'], ['resets', 'Password resets', 'resets']],
  admin: [['overview', 'Home'],
    G('Results', [['analytics', 'Results & analytics'], ['watch', 'Students to watch'], ['reportcards', 'Report cards'], ['exams', 'Exams'], ['marks', 'Marks upload'], ['subjects', 'Subjects']]),
    G('Students', [['students', 'Students'], ['classes', 'Classes'], ['parents', 'Parents', 'lock:parents'], ['attendance', 'Attendance', 'lock:attendance'], ['promotion', 'Promotion'], ['setupxl', 'Set up from Excel'], ['excel', 'Import marks from Excel']]),
    G('Staff', [['teachers', 'Teachers'], ['staff', 'Staff accounts'], ['approvals', 'Approvals', 'approvals'], ['resets', 'Password resets', 'resets']]),
    ['fees', 'Fees', 'lock:fees'], ['calendar', 'Calendar', 'lock:calendar']],
  principal: [['overview', 'Home'],
    G('Results', [['analytics', 'Results & analytics'], ['watch', 'Students to watch'], ['reportcards', 'Report cards']]),
    G('Money', [['fees', 'Fees & payments', 'lock:fees'], ['books', 'School accounts', 'lock:accounts']]),
    G('Staff', [['staff', 'Staff accounts'], ['approvals', 'Approvals', 'approvals'], ['audit', 'Audit log']])],
  finance: [['overview', 'Home'], ['fees', 'Fees & payments', 'lock:fees'], ['books', 'School accounts', 'lock:accounts'], ['approvals', 'My requests']],
  teacher: [['marks', 'Enter marks'], ['attendance', 'Attendance'], ['myclass', 'My class'], ['messages', 'Messages', 'unread'], ['calendar', 'Calendar']],
  parent: [['results', 'Report cards'], ['messages', 'Messages', 'unread'], ['calendar', 'Calendar']],
};
const HIDDEN = { admin: [['subscription', 'Subscription', 'Settings'], ['audit', 'Audit log', 'Settings'], ['student', 'Student profile', 'Students']] };   // reachable from other pages, not the menu
const TABBAR = ['teacher', 'parent', 'finance'];                                         // few pages: bottom tabs on phones
const REPORT_KEYS = ['analytics', 'watch', 'reportcards', 'fees', 'attendance', 'myclass', 'approvals', 'students'];
const MODULE = {
  platform_admin: () => import('./platform.js'), admin: () => import('./admin.js'), principal: () => import('./principal.js'),
  finance: () => import('./finance.js'), teacher: () => import('./teacher.js'), parent: () => import('./parent.js'),
};

const I = { home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>', chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', doc: '<path d="M6 2h9l5 5v15H6zM14 2v6h6"/>', pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>', ok: '<path d="M4 12l5 5L20 6"/>', chat: '<path d="M21 12a8 8 0 01-12 7l-5 1 1-4A8 8 0 1121 12z"/>', cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>', dot: '<circle cx="12" cy="12" r="3"/>' };
const ICON = { overview: 'home', marks: 'pen', attendance: 'ok', myclass: 'chart', messages: 'chat', calendar: 'cal', results: 'doc', fees: 'cash', approvals: 'ok', billing: 'cash' };
const svg = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${I[ICON[k]] || I.dot}</svg>`;

// Short tips shown by the "? Help" button. Plain words, one idea each.
const HELP = {
  overview: ['The coloured cards show what needs attention first. Blue is excellent, red is critical.', 'Use "Do today" for the jobs that are waiting.', 'Your recently opened reports are listed at the bottom.'],
  analytics: ['Pick an exam at the top to see how every class did.', 'Bars use the colour scale, so weak classes stand out at once.'],
  watch: ['These are the students who need help first, worst at the top.', 'Orange is at risk. Red is critical.'],
  reportcards: ['Choose the exam and class, then print or download the report cards.'],
  student: ['Tabs: Academic, Attendance, Personal and Contact.', 'The colours use the same scale as everywhere else: blue is excellent, red is critical.'],
  promotion: ['Print the class report cards first, because they follow the student to the new class.', 'Pick the class, check each student, then review and promote.', 'You can undo right after promoting.'],
  students: ['Add students one by one, or bring many in with "Set up from Excel".', 'Search by name or admission number.'],
  classes: ['Each class has a grading style: 8-4-4 or CBC.'],
  marks: ['Upload marks as a file, or let teachers type them in.'],
  attendance: ['Take the register once a day, per class.', 'The summary shows attendance rates by class.'],
  fees: ['Record payments, set charges and see who owes.', 'Collection rate uses the colour scale: blue is nearly everything collected.'],
  books: ['Set up your money accounts first, then the budget by vote head.', 'A payment voucher is prepared, approved by the principal if it is above the limit, then paid from an account.', 'Mistakes are reversed, never deleted, so the books always add up.'],
  approvals: ['When marks change after publishing, the change waits here for approval.'],
  staff: ['Add teachers, a finance officer or a principal here.', 'Staff sign in with their email.'],
  teachers: ['Pick which classes and subjects each teacher handles.'],
  calendar: ['Add terms, holidays and events. Parents see them too.'],
  messages: ['Write to a parent or teacher. New messages show a red number.'],
  myclass: ['Your class results, ranked. Add a comment for each student.'],
  results: ['Pick an exam to see your child’s report card and progress.'],
  exams: ['Create an exam, enter marks, then press Publish when results are ready for parents.', 'Draft exams are only visible to staff.'],
  subjects: ['Subject codes print on the report card. Use "Add the standard 8-4-4 subjects" to start quickly.', 'Section says which classes take the subject.'],
  parents: ['Link a parent to a student by phone number. Parents sign in with that number.'],
  excel: ['Use your existing marks workbook: one sheet per class, like FORM 3 or GRADE 10.', 'Nothing is saved until you press Import.'],
  resets: ['Give the temporary password to the person directly. They choose a new one when they sign in.'],
  audit: ['A record of who changed what, and when. It cannot be edited.'],
  subscription: ['See your plan, what is due and your payment history.'],
  settings: ['"My account" is about you. "School" is for the whole school (admins only).'],
};

let escKey = () => {};                                                    // the Escape handler of the page that is open now

export async function mountShell(app, s, viewKey) {
  const role = s.role;
  let me, features = { analytics: true, parents: true, chat: true }, badges = {};
  try {
    me = await api('/auth/me');
    if (me.features) features = me.features;
  } catch (e) { toast(e.message, 'bad'); session.clear(); location.hash = '#/login'; return; }

  let nav = NAV[role] || [];
  const flat = [];                                                            // every link, with its group name
  const walk = (list, group = '') => list.forEach((n) => (n.g ? walk(n.items, n.g) : flat.push({ k: n[0], label: n[1], badge: n[2], group })));
  // Once the school has a principal or finance officer, money is theirs and the school admin no longer sees Fees.
  if (role === 'admin' && me.financeSeparated) nav = nav.filter((n) => n[0] !== 'fees');
  walk(nav);
  const valid = new Set([...flat.map((f) => f.k), 'settings', ...(HIDDEN[role] || []).map((h) => h[0])]);
  const key = valid.has(viewKey) ? viewKey : flat[0].k, navKey = key === 'student' ? 'students' : key;   // a student profile belongs to Students
  const acting = session.hasStash();
  const lock = (b) => (b?.startsWith('lock:') && features[b.slice(5)] === false ? ' 🔒' : '');
  const bdg = (b) => `<span class="badge hide" data-badge="${b && !b.startsWith('lock:') ? b : ''}"></span>`;
  const link = (f, cls = '') => `<a href="#/app/${f.k}" class="${f.k === navKey ? 'on' : ''} ${cls}"><span>${esc(f.label)}${lock(f.badge)}</span>${bdg(f.badge)}</a>`;

  const links = nav.map((n) => {
    if (!n.g) { const f = flat.find((x) => x.k === n[0]); return `<div class="tn-item"><a class="tn-btn ${f.k === navKey ? 'on' : ''}" href="#/app/${f.k}"><span>${esc(f.label)}${lock(f.badge)}</span>${bdg(f.badge)}</a></div>`; }
    const open = n.items.some((i) => i[0] === navKey);
    return `<div class="tn-item"><button class="tn-btn ${open ? 'on' : ''}" aria-haspopup="true" aria-expanded="false">${esc(n.g)} <span class="caret">▾</span><span class="dot"></span></button><div class="tn-menu" role="menu">${n.items.map((i) => link(flat.find((x) => x.k === i[0]))).join('')}</div></div>`;
  }).join('');
  const sheet = nav.map((n) => (n.g ? `<div class="sh-h">${esc(n.g)}</div>${n.items.map((i) => link(flat.find((x) => x.k === i[0]))).join('')}` : link(flat.find((x) => x.k === n[0])))).join('');
  const tabbar = TABBAR.includes(role) ? `<nav class="tabbar no-print" aria-label="Main">${flat.map((f) => `<a href="#/app/${f.k}" class="${f.k === navKey ? 'on' : ''}">${svg(f.k)}<span>${esc(f.label)}</span>${bdg(f.badge)}</a>`).join('')}</nav>` : '';
  const sup = me.support || {};

  app.innerHTML = `${acting ? `<div class="banner no-print"><span>Viewing <b>${esc(me.organization || 'a school')}</b> as Acalyze support.</span><button class="btn sm" id="exitAct">Back to platform</button></div>` : ''}
  <div class="shell ${tabbar ? 'has-tabbar' : ''}"><header class="topnav no-print"><button class="tn-burger" id="burger" aria-label="Open menu">☰</button><a class="brand" href="#/app"><i></i>Acalyze</a>
    <nav class="tn-links" aria-label="Main">${links}</nav>
    <div class="tn-item jump"><input id="jump" class="tn-search" placeholder="Jump to…" aria-label="Jump to a page" autocomplete="off"><div class="tn-menu" id="jumpRes"></div></div>
    <div class="tn-item right"><button class="tn-av" id="avBtn" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">${esc(initials(me.name))}</button>
      <div class="tn-menu acct" role="menu"><div class="acct-h"><b>${esc(me.name || '')}</b><span class="mut sm">${esc([me.roleLabel, me.organization].filter(Boolean).join(' · '))}</span></div>
        <a href="#/app/settings">Settings</a><button id="themeBtn">${theme.isDark() ? 'Switch to light mode' : 'Switch to dark mode'}</button>${isInstalled() ? '' : '<button id="instBtn">Install app</button>'}
        ${sup.phone || sup.email ? `<div class="acct-s sm mut">${esc(sup.title || 'Need help?')} ${sup.phone ? `<a href="tel:${esc(String(sup.phone).replace(/[^\d+]/g, ''))}">${esc(sup.phone)}</a>` : ''}</div>` : ''}
        <hr><button id="out" class="danger">Sign out</button></div></div></header>
  <div class="sheet no-print" id="sheet">${sheet}<div class="sh-h">Account</div><a href="#/app/settings">Settings</a></div>
  <div class="mainwrap"><main class="main" id="main" tabindex="-1"></main><footer class="support no-print" id="support">${supportHtml(me.support)}</footer></div>${tabbar}</div>`;

  // drop-downs: click to open, click elsewhere or press Escape to close
  const closeAll = () => $$('.tn-item.open', app).forEach((x) => { x.classList.remove('open'); $('[aria-expanded]', x)?.setAttribute('aria-expanded', 'false'); });
  $('.shell', app).addEventListener('click', (e) => {
    const btn = e.target.closest('.tn-btn[aria-haspopup], .tn-av');
    if (btn) { const item = btn.closest('.tn-item'), was = item.classList.contains('open'); closeAll(); if (!was) { item.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); } return; }
    if (e.target.closest('.tn-menu a, .tn-menu button, .sheet a')) { closeAll(); $('#sheet', app).classList.remove('open'); $('#jump', app).value = ''; return; }
    if (!e.target.closest('.jump')) closeAll();
  });
  removeEventListener('keydown', escKey);
  escKey = (e) => { if (e.key === 'Escape') { closeAll(); $('#sheet', app)?.classList.remove('open'); } };
  addEventListener('keydown', escKey);
  $('#burger', app).onclick = () => $('#sheet', app).classList.toggle('open');

  const pool = [...flat, { k: 'settings', label: 'Settings', group: 'Account' }, ...(HIDDEN[role] || []).filter((h) => h[0] !== 'student').map((h) => ({ k: h[0], label: h[1], group: h[2] }))];
  const jump = $('#jump', app), res = $('#jumpRes', app);
  jump.oninput = () => {
    const q = jump.value.trim().toLowerCase(), hits = q ? pool.filter((p) => p.label.toLowerCase().includes(q)).slice(0, 7) : [];
    res.innerHTML = hits.map((p) => `<a href="#/app/${p.k}">${esc(p.label)}<span class="mut sm">${esc(p.group)}</span></a>`).join('') || (q ? '<div class="mut sm" style="padding:8px 12px">Nothing matches</div>' : '');
    jump.closest('.tn-item').classList.toggle('open', !!q);
  };
  jump.onkeydown = (e) => { if (e.key === 'Enter') $('a', res)?.click(); };

  $('#themeBtn', app).onclick = (e) => { theme.toggle(); e.currentTarget.textContent = theme.isDark() ? 'Switch to light mode' : 'Switch to dark mode'; };
  $('#instBtn', app)?.addEventListener('click', installApp);
  $('#out', app).onclick = () => { session.clear(); location.hash = '#/login'; };
  $('#exitAct', app)?.addEventListener('click', () => { session.restore(); location.hash = '#/app'; location.reload(); });

  const here = flat.find((f) => f.k === key) || pool.find((p) => p.k === key) || (HIDDEN[role] || []).map((h) => ({ k: h[0], label: h[1], group: h[2] })).find((p) => p.k === key);
  const ctx = { me, role, features, key,
    async refreshBadges() { await updateBadges(app, role, features); },
    go(k) { location.hash = `#/app/${k}`; } };
  const el = $('#main', app);
  const bar = (title, sub = '', actions = '') => `<div class="topbar no-print"><div>${here?.group && here.group !== here.label ? `<div class="crumbs">${esc(here.group)} <span>›</span> ${esc(here.label)}</div>` : ''}<h1>${esc(title)}</h1>${sub ? `<div class="mut sm" style="margin-top:3px">${esc(sub)}</div>` : ''}</div><div class="row">${actions}${HELP[key] ? '<button class="btn sm" data-help>? Help</button>' : ''}</div></div>`;
  ctx.bar = bar;
  el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-help]')) return;
    modal(`<h3>Help: ${esc(here?.label || 'this page')}</h3><ul class="help-l">${HELP[key].map((t) => `<li>${esc(t)}</li>`).join('')}</ul>${sup.phone || sup.email ? `<p class="sm mut">Still stuck? ${esc([sup.phone, sup.email].filter(Boolean).join(' · '))}</p>` : ''}<div class="row" style="justify-content:flex-end"><button class="btn primary" data-close>Got it</button></div>`);
  });

  el.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const mod = key === 'settings' ? await import('./settings.js') : await MODULE[role]();
    const view = mod.views[key];
    el.classList.remove('fade'); void el.offsetWidth; el.classList.add('fade');
    await view(el, ctx);
    if (REPORT_KEYS.includes(key)) recent.add(key);
  } catch (e) { console.error(e); el.innerHTML = `${bar('Something went wrong')}<div class="notice bad">${esc(e.message)}</div>`; }
  updateBadges(app, role, features);
  watchBookings(app, role, features);
}

// "Need help?" line at the bottom of the page: the school's contact for parents, Acalyze's for school admins.
function supportHtml(s) {
  if (!s || (!s.email && !s.phone)) return '';
  const tel = s.phone ? `<a href="tel:${esc(String(s.phone).replace(/[^\d+]/g, ''))}">${esc(s.phone)}</a>` : '';
  const mail = s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : '';
  return `<b>${esc(s.title || 'Need help?')}</b>${[tel, mail].filter(Boolean).map((x) => `<span>${x}</span>`).join('')}${s.note ? `<span class="mut">${esc(s.note)}</span>` : ''}`;
}

// While you have Acalyze open, check for new booking requests every minute and tell you straight away.
let bookingTimer = null, lastBookings = null;
function watchBookings(app, role, features) {
  clearInterval(bookingTimer);
  if (role !== 'platform_admin') return;
  bookingTimer = setInterval(async () => {
    try {
      const { n } = await api('/bookings/count');
      if (lastBookings !== null && n > lastBookings) { toast('New booking request. Open Bookings to confirm it.', 'ok'); updateBadges(app, role, features); }
      lastBookings = n;
    } catch { /* offline: try again next minute */ }
  }, 60_000);
}

async function updateBadges(app, role, features) {
  const set = (name, n) => $$(`[data-badge="${name}"]`, app).forEach((b) => { b.textContent = n; b.classList.toggle('hide', !n); });
  try {
    if (role === 'admin') {
      const [ov] = await Promise.all([api('/analytics/overview')]);
      set('approvals', ov.pending.edits); set('resets', ov.pending.passwords);
    } else if (role === 'principal') {
      const c = await api('/approval-requests/count'); set('approvals', c.n);
    } else if (role === 'platform_admin') {
      const [regs, pw, bk] = await Promise.all([api('/organizations/registrations?status=pending'), api('/password-requests'), api('/bookings/count')]);
      set('regs', regs.length); set('resets', pw.length); set('bookings', bk.n);
    }
    if ((role === 'teacher' || role === 'parent') && features.chat !== false) {
      const u = await api('/chat/unread').catch(() => null); if (u) set('unread', u.unread);
    }
  } catch { /* badges are a nicety, never block the page */ }
  $$('.tn-item', app).forEach((g) => g.classList.toggle('has-badge', !!$('.tn-menu .badge:not(.hide)', g)));   // a dot on a group that has something waiting
}
