import crypto from 'node:crypto';
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ---- cashbook ----
// entries: [{ date: 'YYYY-MM-DD', at, ref, text, kind, id, in, out }]  (money in and money out, one of them zero)
// Returns the rows from `from` to `to` with a running balance, the balance brought forward, and the totals.
export function buildCashbook({ openingBalance = 0, openingDate = '0000-01-01', entries, from = openingDate, to = '9999-12-31' }) {
  const sorted = entries.filter((e) => e.date >= openingDate && e.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.at || '').localeCompare(String(b.at || '')) || String(a.ref).localeCompare(String(b.ref)));
  let bal = r2(openingBalance);
  for (const e of sorted) if (e.date < from) bal = r2(bal + e.in - e.out);
  const broughtForward = bal, rows = []; let totalIn = 0, totalOut = 0;
  for (const e of sorted) {
    if (e.date < from) continue;
    bal = r2(bal + e.in - e.out); totalIn += e.in; totalOut += e.out;
    rows.push({ ...e, balance: bal });
  }
  return { broughtForward, rows, totalIn: r2(totalIn), totalOut: r2(totalOut), closing: bal };
}

// ---- budget ----
// A voucher is over budget when the head has a budget and this amount is more than what is still available.
export const budgetAvailable = (budget, committed, spent) => (budget == null ? null : r2(budget - committed - spent));
export const isOverBudget = (budget, committed, spent, amount) => budget != null && r2(amount) > budgetAvailable(budget, committed, spent);

// ---- bank statement matching ----
export const lineKey = (l) => crypto.createHash('sha1').update([l.date, r2(l.amount), String(l.description || '').trim().toLowerCase(), String(l.reference || '').trim().toLowerCase()].join('|')).digest('hex');

const dayNum = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
// lines: [{ id, date, amount (credit +, debit -), text }]   entries: [{ ref, date, amount (in +, out -), text, code }]
// A line is matched only when exactly one book entry fits (same amount, within a few days), or when a code in the line text
// (a receipt number, M-Pesa code or cheque number) picks one of several. Each entry matches at most one line.
export function autoMatch(lines, entries, { days = 4 } = {}) {
  const used = new Set(), out = [];
  for (const l of lines) {
    let cands = entries.filter((e) => !used.has(e.ref) && Math.abs(e.amount - l.amount) < 0.005 && Math.abs(dayNum(e.date) - dayNum(l.date)) <= days);
    if (cands.length > 1) {
      const text = String(l.text || '').toLowerCase();
      const byCode = cands.filter((e) => e.code && text.includes(String(e.code).toLowerCase()));
      if (byCode.length === 1) cands = byCode;
    }
    if (cands.length === 1) { used.add(cands[0].ref); out.push({ lineId: l.id, ref: cands[0].ref }); }
  }
  return out;
}
