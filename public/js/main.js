import './install.js';
import { api, session } from './api.js';
import { esc, $, $$, toast, theme, run } from './ui.js';
import { publicHome, loginView, registerView, forgotView, setPasswordView } from './views/public.js';
import { mountShell } from './views/shell.js';

// Hash router: #/ (landing), #/login, #/register, #/forgot, #/app/<view>
const app = document.getElementById('app');

async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [page] = hash.split('/');
  const s = session.get();

  if (page === 'app') {
    if (!s?.token) { location.hash = '#/login'; return; }
    return mountShell(app, s, hash.split('/')[1] || '');
  }
  if (page === 'login') return loginView(app, onSignedIn);
  if (page === 'register') return registerView(app);
  if (page === 'forgot') return forgotView(app);
  if (page === 'set-password') return setPasswordView(app, onSignedIn);
  if (s?.token && !page) { location.hash = '#/app'; return; }     // signed in: go straight to the app
  return publicHome(app);
}

// Called after a successful login or password set. `r` is the API response.
function onSignedIn(r) {
  session.clear();
  session.set({ token: r.token, role: r.kind === 'admin' ? 'admin' : r.kind, name: r.name || r.admin?.name || r.teacher?.full_name || r.parent?.name || '' });
  location.hash = '#/app';
}

addEventListener('hashchange', route);
theme.init();
route();
