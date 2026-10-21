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
export const isCleared = (charged, paid) => Number(charged) > 0 && Number(paid) >= Number(charged);

export const balance = (charged, paid) => r2(Number(charged) - Number(paid));
export const receiptNumber = (orgCode, seq) => `${orgCode}-${String(seq).padStart(6, '0')}`;

// rows: [{ class_name, charged, paid }] one per student.
export function summarizeBalances(rows) {
  const byClass = new Map(); let charged = 0, paid = 0, owing = 0;
  for (const r of rows) {
    const c = Number(r.charged), p = Number(r.paid), b = balance(c, p);
    charged += c; paid += p; if (b > 0) owing++;
    const k = r.class_name || '(no class)', x = byClass.get(k) || { class_name: k, charged: 0, paid: 0, students: 0 };
    x.charged += c; x.paid += p; x.students++; byClass.set(k, x);
  }
  return {
    charged: r2(charged), collected: r2(paid), outstanding: r2(Math.max(0, charged - paid)), studentsOwing: owing, students: rows.length,
    collectionRate: charged > 0 ? Math.round((paid / charged) * 1000) / 10 : null,
    byClass: [...byClass.values()].map((x) => ({ ...x, charged: r2(x.charged), paid: r2(x.paid), balance: balance(x.charged, x.paid), rate: x.charged > 0 ? Math.round((x.paid / x.charged) * 1000) / 10 : null })).sort((a, b) => a.class_name.localeCompare(b.class_name)),
  };
}
