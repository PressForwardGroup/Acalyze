// The public website lives on its own address, set on the server as SITE_URL.
// Any link marked data-site points there: data-site="" is the home page, data-site="/book/" the booking page.
// Until the address is known (or if it is not set) those links stay hidden, and the logo goes to sign-in.
export const siteInfo = { url: '' };

export function applySiteLinks(root = document) {
  root.querySelectorAll('[data-site]').forEach((a) => {
    if (siteInfo.url) { a.hidden = false; a.href = siteInfo.url + (a.dataset.site || '/'); }
    else if (a.dataset.site === '') a.setAttribute('href', '#/login');
    else a.hidden = true;
  });
}

if (typeof document !== 'undefined' && typeof fetch === 'function') {
  const app = document.getElementById('app') || document.body;
  new MutationObserver(() => applySiteLinks()).observe(app, { childList: true, subtree: true });
  fetch('/public-api/contact').then((r) => r.json()).then((c) => { siteInfo.url = String(c.siteUrl || '').replace(/\/+$/, ''); applySiteLinks(); }).catch(() => {});
}
