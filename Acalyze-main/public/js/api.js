// API client + session. The session lives in localStorage; the token is sent
// as a Bearer header. A 401 anywhere signs the user out cleanly.
const KEY = 'acalyze.session';
const PKEY = 'acalyze.platformSession';   // platform admin's own session while viewing a school

export const session = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  set(s) { localStorage.setItem(KEY, JSON.stringify(s)); },
  clear() { localStorage.removeItem(KEY); localStorage.removeItem(PKEY); },
  stash() { localStorage.setItem(PKEY, localStorage.getItem(KEY)); },
  restore() { const p = localStorage.getItem(PKEY); if (p) { localStorage.setItem(KEY, p); localStorage.removeItem(PKEY); return true; } return false; },
  hasStash() { return !!localStorage.getItem(PKEY); },
};

export async function api(path, { method = 'GET', body, token } = {}) {
  const s = session.get();
  const headers = { 'Content-Type': 'application/json' };
  const t = token ?? s?.token;
  if (t) headers.Authorization = `Bearer ${t}`;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error("Can't reach the server. Check your internet connection and try again.");
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (res.status === 401 && s && token === undefined) { session.clear(); location.hash = '#/login'; throw new Error('Your session expired. Please sign in again.'); }
  if (!res.ok) { const e = new Error(data?.error || `Something went wrong (${res.status}).`); e.status = res.status; throw e; }
  return data;
}
