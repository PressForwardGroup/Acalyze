// Reads a bank statement saved as CSV into { date, description, reference, amount } lines (credits positive, debits negative).
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const p2 = (n) => String(n).padStart(2, '0');
// 2026-10-05, 05/10/2026, 5-10-26, 5 Oct 2026, 05-Oct-26 -> 2026-10-05 (day first, as banks in Kenya write it)
export function parseDate(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
  m = s.match(/^(\d{1,2})[\/\-. ](\d{1,2}|[A-Za-z]{3,9})[\/\-. ](\d{2,4})/);
  if (!m) return null;
  const mon = /^\d+$/.test(m[2]) ? Number(m[2]) : MONTHS[m[2].slice(0, 3).toLowerCase()];
  let y = Number(m[3]); if (y < 100) y += 2000;
  return mon >= 1 && mon <= 12 && Number(m[1]) >= 1 && Number(m[1]) <= 31 ? `${y}-${p2(mon)}-${p2(m[1])}` : null;
}
export function parseNumber(v) {
  let s = String(v ?? '').trim(); if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /dr$/i.test(s);
  s = s.replace(/[^\d.]/g, ''); if (!s) return null;
  const n = Number(s); return Number.isFinite(n) ? (neg ? -n : n) : null;
}

// Finds the columns by their headings (date, description, reference, debit/credit or amount) and turns each row into a line.
export function readStatement(text) {
  const rows = parseCsv(text);
  const at = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /(debit|credit|amount|withdraw|deposit|paid|money)/i.test(c)));
  if (at < 0) return { lines: [], error: 'Could not find the column headings (Date, Description, Debit/Credit or Amount).' };
  const head = rows[at].map((c) => c.trim().toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const iDate = col(/date/), iDesc = col(/(descr|narrat|detail|particular|transaction)/), iRef = col(/(ref|cheque|chq|receipt|code)/);
  const iDebit = col(/(debit|withdraw|money out|paid out)/), iCredit = col(/(credit|deposit|money in|paid in)/), iAmt = col(/^(amount|value)/);
  const lines = [];
  for (const r of rows.slice(at + 1)) {
    const date = parseDate(r[iDate]); if (!date) continue;
    let amount = null;
    if (iDebit >= 0 || iCredit >= 0) { const d = iDebit >= 0 ? parseNumber(r[iDebit]) : null, c = iCredit >= 0 ? parseNumber(r[iCredit]) : null; if (c) amount = Math.abs(c); else if (d) amount = -Math.abs(d); }
    else if (iAmt >= 0) amount = parseNumber(r[iAmt]);
    if (!amount) continue;
    lines.push({ date, description: (iDesc >= 0 ? r[iDesc] : '').trim(), reference: (iRef >= 0 ? r[iRef] : '').trim(), amount });
  }
  return { lines, error: lines.length ? null : 'No transactions were found under the headings.' };
}
