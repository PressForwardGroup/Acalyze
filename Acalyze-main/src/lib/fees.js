export const METHODS = ['cash', 'mpesa', 'bank', 'other'];
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// A money amount from user input: positive, at most 2 decimals' worth, sensible size.
export function parseAmount(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) return null;
  return r2(n);
}
// Does this charge apply to this student? (The same rule is written in SQL in feeSql.js; keep them identical.)
//   item: { published, audience: 'all'|'day'|'boarding'|'optional', grade, grades }   student: { grade, boarding, assigned }
export function chargeApplies(item, st) {
  if (!item.published) return false;
  if (item.audience === 'optional') return !!st.assigned;
  if (item.grade && item.grade !== st.grade) return false;
  if (item.grades?.length && !item.grades.includes(st.grade)) return false;
  return item.audience === 'all' || item.audience === st.boarding;
}
// A student is "cleared" when they have charges and have paid at least all of them.
// `charged` is what is owed after waivers; `gross` is before, so a student whose fees were fully waived counts as cleared.
export const isCleared = (charged, paid, gross = charged) => Number(gross) > 0 && Number(paid) >= Number(charged);

export const balance = (charged, paid) => r2(Number(charged) - Number(paid));
export const receiptNumber = (orgCode, seq) => `${orgCode}-${String(seq).padStart(6, '0')}`;

// rows: [{ class_name, charged, paid }] one per student.
export function summarizeBalances(rows) {
  const byClass = new Map(); let charged = 0, paid = 0, owed = 0, credit = 0, applied = 0, owing = 0, inCredit = 0, waived = 0;
  for (const r of rows) {
    const c = Number(r.charged), p = Number(r.paid), b = balance(c, p);
    charged += c; paid += p; applied += Math.min(p, c); waived += Number(r.waived || 0);
    if (b > 0) { owing++; owed += b; } else if (b < 0) { inCredit++; credit += -b; }   // overpaid money is a credit, not a reduction of what others owe
    const k = r.class_name || '(no class)', x = byClass.get(k) || { class_name: k, charged: 0, paid: 0, applied: 0, students: 0 };
    x.charged += c; x.paid += p; x.applied += Math.min(p, c); x.students++; byClass.set(k, x);
  }
  return {
    charged: r2(charged), waived: r2(waived), collected: r2(paid), outstanding: r2(owed), credits: r2(credit), studentsOwing: owing, studentsInCredit: inCredit, students: rows.length,
    collectionRate: charged > 0 ? Math.round((applied / charged) * 1000) / 10 : null,
    byClass: [...byClass.values()].map((x) => ({ class_name: x.class_name, students: x.students, charged: r2(x.charged), paid: r2(x.paid), balance: balance(x.charged, x.paid), rate: x.charged > 0 ? Math.round((x.applied / x.charged) * 1000) / 10 : null })),
  };
}

// ---- paying the oldest charges first ----
// Payments are not tied to one charge. They are applied in order: whole-year charges, then Term 1, 2, 3 (by due date, then name).
const termRank = (t) => (t == null || t === '' ? 0 : { 'Term 1': 1, 'Term 2': 2, 'Term 3': 3 }[t] ?? 4);
export const chargeOrder = (a, b) => termRank(a.term) - termRank(b.term) || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')) || String(a.name).localeCompare(String(b.name));

// charges: [{ name, vote_head, term, due_date, amount }]
//   waived: total waivers, bursaries and discounts for the year (they cover the oldest charges first)
//   paid:   money kept for the year (payments minus refunds), applied to what is left, oldest first
// Returns each charge with what was waived, what was paid and what is still owed, plus any credit left over.
export function allocatePayments(charges, paid, waived = 0) {
  let w = Math.max(0, r2(waived)), left = Math.max(0, r2(paid));
  const lines = [...charges].sort(chargeOrder).map((c) => {
    const amt = r2(c.amount), cut = r2(Math.min(amt, w));
    w = r2(w - cut);
    const applied = r2(Math.min(amt - cut, left));
    left = r2(left - applied);
    return { ...c, amount: amt, waived: cut, paid: applied, balance: r2(amt - cut - applied) };
  });
  return { lines, credit: r2(left) };
}

// ---- overdue ageing ----
export function ageBucket(days) {
  if (days <= 0) return 'current';
  return days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90plus';
}
const dayNumber = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
// lines: allocated charges (with balance and due_date). today: 'YYYY-MM-DD'.
// Only charges with a due date that has passed count as overdue.
export function overdueSummary(lines, today) {
  let overdue = 0, oldest = null;
  for (const l of lines) {
    if (l.balance > 0 && l.due_date && l.due_date < today) { overdue = r2(overdue + l.balance); if (!oldest || l.due_date < oldest) oldest = l.due_date; }
  }
  const days = oldest ? dayNumber(today) - dayNumber(oldest) : 0;
  return { overdue, oldest, days, bucket: oldest ? ageBucket(days) : 'current' };
}

// Room left to refund: money kept beyond what is owed, less refunds already asked for.
export const refundable = (charged, paid, pendingRefunds = 0) => Math.max(0, r2(Number(paid) - Number(charged) - Number(pendingRefunds)));

// Add up allocated lines by any key, e.g. rollupBy(lines, (l) => l.vote_head || l.name)
export function rollupBy(lines, keyFn) {
  const m = new Map();
  for (const l of lines) {
    const k = keyFn(l), x = m.get(k) || { key: k, charged: 0, waived: 0, paid: 0, balance: 0 };
    x.charged += l.amount; x.waived += l.waived || 0; x.paid += l.paid; x.balance += l.balance; m.set(k, x);
  }
  return [...m.values()].map((x) => ({ key: x.key, charged: r2(x.charged), waived: r2(x.waived), paid: r2(x.paid), balance: r2(x.balance) }));
}
