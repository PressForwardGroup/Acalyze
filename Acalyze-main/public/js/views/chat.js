import { api } from '../api.js';
import { esc, $, $$, toast, run } from '../ui.js';

// Parent <-> teacher messages. Same screen for both roles; the server decides who may talk to whom.
export async function messages(el, ctx) {
  let contacts;
  try { contacts = await api('/chat/contacts'); }
  catch (e) {
    if (e.status === 402) { el.innerHTML = `${ctx.bar('Messages')}<div class="card empty">Messaging isn't included in your school's plan.</div>`; return; }
    throw e;
  }
  const mineIsParent = ctx.role === 'parent';
  let cur = null, timer = null;
  el.innerHTML = `${ctx.bar('Messages', mineIsParent ? "Message your child's teachers" : "Message parents of the children you teach")}
  <div class="card pad0 chat"><div class="chat-l" id="cl">${contacts.length ? contacts.map((c) => `<button data-id="${c.id}"><div class="b">${esc(c.full_name)} ${c.unread ? `<span class="pill warn">${c.unread} new</span>` : ''}</div><div class="sm mut">${esc(c.child)} · ${esc(c.class_name)}</div></button>`).join('') : '<div class="empty">No one to message yet.</div>'}</div>
    <div style="display:flex;flex-direction:column"><div class="card-h" id="who">Choose someone to message</div><div class="msgs" id="msgs"></div>
    <form id="f" class="row hide" style="padding:12px;border-top:1px solid var(--line);flex-wrap:nowrap"><input class="i" id="t" placeholder="Write a message…" maxlength="2000" autocomplete="off"><button class="btn primary">Send</button></form></div></div>`;
  const draw = (list) => { const box = $('#msgs', el); const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 60; box.innerHTML = list.length ? list.map((m) => `<div class="msg ${m.mine ? 'mine' : ''}">${esc(m.body)}<div class="sm" style="opacity:.6;margin-top:3px">${new Date(m.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div>`).join('') : '<div class="empty">No messages yet. Say hello.</div>'; if (atEnd) box.scrollTop = box.scrollHeight; };
  const load = async () => { if (!cur || !document.body.contains(el)) return clearInterval(timer); draw(await api(`/chat/thread?withId=${cur.id}`)); };
  $$('#cl button', el).forEach((b) => (b.onclick = async () => {
    cur = contacts.find((c) => c.id === b.dataset.id); $$('#cl button', el).forEach((x) => x.classList.toggle('on', x === b));
    $('#who', el).textContent = `${cur.full_name} · ${cur.child}`; $('#f', el).classList.remove('hide');
    await load(); $('#msgs', el).scrollTop = 1e9; clearInterval(timer); timer = setInterval(() => load().catch(() => {}), 15000); ctx.refreshBadges?.();
  }));
  $('#f', el).onsubmit = (e) => { e.preventDefault(); const t = $('#t', el).value.trim(); if (!t || !cur) return; run(null, async () => { await api('/chat/send', { method: 'POST', body: { toId: cur.id, body: t } }); $('#t', el).value = ''; await load(); $('#msgs', el).scrollTop = 1e9; }); };
}
