import { api } from '../api.js';
import { esc, $, toast, run, theme } from '../ui.js';

const nav = (extra = '') => `<nav class="pub-nav"><a class="brand" href="#/"><i></i>Acalyze</a>
  <div class="row"><button class="btn sm" id="themeBtn" aria-label="Toggle dark mode">${theme.isDark() ? '☀ Light' : '☾ Dark'}</button>${extra}</div></nav>`;
function wireTheme(root) {
  $('#themeBtn', root)?.addEventListener('click', (e) => { theme.toggle(); e.currentTarget.textContent = theme.isDark() ? '☀ Light' : '☾ Dark'; });
}

export function publicHome(root) {
  root.innerHTML = `<div class="pub fade">${nav(`<a class="btn" href="#/login">Sign in</a><a class="btn primary" href="#/register">Register your school</a>`)}
  <section class="hero"><div>
    <h1>Results your whole school can stand behind.</h1>
    <p>Acalyze turns raw marks into trusted report cards and clear analytics. Graded and ranked the way your school already does it, for both 8-4-4 and CBC, with parents kept in the loop.</p>
    <div class="row"><a class="btn primary" href="#/register">Register your school</a><a class="btn" href="#/login">Sign in</a></div>
    <p class="sm mut" style="margin-top:34px;font-size:13px">Built for schools in Kenya</p></div>
    <div class="paper" aria-hidden="true">
      <div class="center" style="border-bottom:2px solid var(--navy);padding-bottom:8px;margin-bottom:12px"><div class="b" style="font-family:var(--serif)">Riverside Academy</div><div class="sm mut">Term 2 Report · Form 3</div></div>
      <div class="row sm mut" style="justify-content:space-between;margin-bottom:8px"><span>Amara Otieno</span><span>Position 3 of 210</span></div>
      ${[['Mathematics', 'A'], ['English', 'B+'], ['Chemistry', 'A-']].map(([s, g]) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line2)"><span>${s}</span><b>${g}</b></div>`).join('')}
      <div class="sm" style="margin-top:12px;color:var(--gold-ink);font-weight:600">Overall: A- · Very good</div></div></section>
  <section class="steps">${[['1', 'Tell us about your school', 'Register with your school name, location and rough student numbers.'],
    ['2', 'We review and approve', "A short check, then your school's own private workspace is created."],
    ['3', 'Add teachers and students', 'Your admin login arrives the same day. Upload your students and start entering marks.']]
    .map(([n, h, p]) => `<div><div class="num">${n}</div><h2 style="margin:8px 0">${h}</h2><p class="mut">${p}</p></div>`).join('')}</section>
  <section class="grid g3" style="margin-bottom:30px">${[['Analytics for admins', 'Podium, subject champions, class comparison and who needs attention, as soon as marks are in.'],
    ['Report cards your way', 'The classic printed form or a modern on-screen card. Print a whole class or grade in one go.'],
    ['Parents in the loop', 'Parents sign in with their phone number to see results and message teachers.']]
    .map(([h, p]) => `<div class="card"><h3>${h}</h3><p class="mut" style="margin:8px 0 0">${p}</p></div>`).join('')}</section></div>`;
  wireTheme(root);
}

export function registerView(root) {
  root.innerHTML = `<div class="pub fade">${nav(`<a class="btn" href="#/login">Sign in</a>`)}
  <div class="card" style="max-width:720px;margin:0 auto;padding:32px"><h1>Register your school</h1>
  <p class="mut">We'll review your request and set up your school's workspace. You'll hear back within one working day.</p>
  <form id="f" class="form-grid" style="margin-top:20px" novalidate>
    <div><label class="f" for="sn">School name *</label><input class="i" id="sn" required autocomplete="organization"></div>
    <div><label class="f" for="loc">Location</label><input class="i" id="loc" placeholder="Town, county"></div>
    <div><label class="f" for="cn">Your name</label><input class="i" id="cn" autocomplete="name"></div>
    <div><label class="f" for="ce">Your email *</label><input class="i" id="ce" type="email" required autocomplete="email" placeholder="you@yourschool.ac.ke"></div>
    <div><label class="f" for="cp">Phone</label><input class="i" id="cp" type="tel" autocomplete="tel" placeholder="07xx xxx xxx"></div>
    <div><label class="f" for="sys">Curriculum</label><select class="i" id="sys"><option>8-4-4</option><option>CBC</option><option>Both</option></select></div>
    <div><label class="f" for="cnt">Approx. number of students</label><input class="i" id="cnt" type="number" min="1" placeholder="e.g. 450"></div>
    <div style="grid-column:1/-1"><button class="btn primary" id="go">Submit for review</button></div></form>
  <div id="done" class="notice ok hide" style="margin-top:18px"></div></div></div>`;
  wireTheme(root);
  $('#f', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const v = (id) => $('#' + id, root).value.trim();
    if (!v('sn') || !/^\S+@\S+\.\S+$/.test(v('ce'))) return toast('Enter the school name and a valid email.', 'bad');
    run($('#go', root), async () => {
      const r = await api('/register-school', { method: 'POST', body: { schoolName: v('sn'), location: v('loc'), contactName: v('cn'), contactEmail: v('ce'), contactPhone: v('cp'), systemUsed: v('sys'), approxStudents: v('cnt') } });
      $('#f', root).classList.add('hide'); const d = $('#done', root); d.classList.remove('hide'); d.textContent = r.message;
    });
  });
}

export function loginView(root, onSignedIn) {
  root.innerHTML = `<div class="pub fade">${nav()}<div class="card auth-card"><h1>Sign in</h1>
  <p class="mut" style="margin:6px 0 20px">Staff use your email. Parents use your phone number.</p>
  <form id="f" novalidate><label class="f" for="id">Email or phone number</label><input class="i" id="id" autocomplete="username" autofocus>
  <label class="f" for="pw" style="margin-top:14px">Password</label>
  <div class="row" style="gap:6px;flex-wrap:nowrap"><input class="i" id="pw" type="password" autocomplete="current-password"><button type="button" class="btn" id="show" aria-label="Show password">Show</button></div>
  <button class="btn primary" id="go" style="width:100%;justify-content:center;margin-top:20px">Sign in</button></form>
  <p class="sm" style="margin-top:16px"><a href="#/forgot">Forgot your password?</a></p>
  <p class="sm mut">New school? <a href="#/register">Register here</a></p></div></div>`;
  wireTheme(root);
  $('#show', root).onclick = (e) => { const p = $('#pw', root); p.type = p.type === 'password' ? 'text' : 'password'; e.currentTarget.textContent = p.type === 'password' ? 'Show' : 'Hide'; };
  $('#f', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const identifier = $('#id', root).value.trim(), password = $('#pw', root).value;
    if (!identifier || !password) return toast('Enter your email or phone number, and your password.', 'bad');
    run($('#go', root), async () => {
      const r = await api('/auth/login', { method: 'POST', body: { identifier, password }, token: '' });
      if (r.needsPasswordChange) { sessionStorage.setItem('acalyze.reset', JSON.stringify({ resetToken: r.resetToken, kind: r.kind })); location.hash = '#/set-password'; return; }
      onSignedIn(r);
    });
  });
}

export function forgotView(root) {
  root.innerHTML = `<div class="pub fade">${nav()}<div class="card auth-card"><h1>Forgot password</h1>
  <p class="mut" style="margin:6px 0 20px">Enter your email (staff) or phone number (parents). Your school admin will give you a temporary password.</p>
  <form id="f"><label class="f" for="id">Email or phone number</label><input class="i" id="id" autofocus>
  <button class="btn primary" id="go" style="width:100%;justify-content:center;margin-top:18px">Request a reset</button></form>
  <div id="done" class="notice ok hide" style="margin-top:16px"></div><p class="sm" style="margin-top:16px"><a href="#/login">Back to sign in</a></p></div></div>`;
  wireTheme(root);
  $('#f', root).addEventListener('submit', (e) => {
    e.preventDefault(); const identifier = $('#id', root).value.trim(); if (!identifier) return;
    run($('#go', root), async () => {
      const r = await api('/password-requests/forgot', { method: 'POST', body: { identifier }, token: '' });
      const d = $('#done', root); d.classList.remove('hide'); d.textContent = r.message;
    });
  });
}

export function setPasswordView(root, onSignedIn) {
  let st = null; try { st = JSON.parse(sessionStorage.getItem('acalyze.reset')); } catch { /* none */ }
  if (!st?.resetToken) { location.hash = '#/login'; return; }
  root.innerHTML = `<div class="pub fade">${nav()}<div class="card auth-card"><h1>Choose a new password</h1>
  <p class="mut" style="margin:6px 0 20px">This is your first sign-in (or your password was reset). Pick a password only you know.</p>
  <form id="f"><label class="f" for="a">New password</label><input class="i" id="a" type="password" autocomplete="new-password" autofocus>
  <label class="f" for="b" style="margin-top:14px">Type it again</label><input class="i" id="b" type="password" autocomplete="new-password">
  <button class="btn primary" id="go" style="width:100%;justify-content:center;margin-top:18px">Save and continue</button></form></div></div>`;
  wireTheme(root);
  $('#f', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const a = $('#a', root).value, b = $('#b', root).value;
    if (a.length < 6) return toast('Use at least 6 characters.', 'bad');
    if (a !== b) return toast("The two passwords don't match.", 'bad');
    run($('#go', root), async () => {
      const r = await api('/auth/set-password', { method: 'POST', body: { resetToken: st.resetToken, newPassword: a }, token: '' });
      sessionStorage.removeItem('acalyze.reset'); toast('Password saved', 'ok'); onSignedIn(r);
    });
  });
}
