import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCashbook, isOverBudget, budgetAvailable, autoMatch, lineKey } from '../src/lib/books.js';
import { amountWords } from '../public/js/words.js';
import { readStatement, parseDate, parseNumber, parseCsv } from '../public/js/csv.js';

const e = (date, inn, out, ref = date + inn + out) => ({ date, at: date, ref, text: ref, in: inn, out });

test('cashbook: running balance, brought forward and totals', () => {
  const entries = [e('2026-02-10', 0, 2000), e('2026-02-01', 5000, 0), e('2026-02-20', 1000, 0), e('2026-01-05', 99999, 0)];   // the January entry is before the books open
  const all = buildCashbook({ openingBalance: 10000, openingDate: '2026-02-01', entries });
  assert.deepEqual(all.rows.map((r) => r.balance), [15000, 13000, 14000]);
  assert.equal(all.closing, 14000);
  const later = buildCashbook({ openingBalance: 10000, openingDate: '2026-02-01', entries, from: '2026-02-10' });
  assert.equal(later.broughtForward, 15000);
  assert.deepEqual([later.totalIn, later.totalOut, later.closing], [1000, 2000, 14000]);
  assert.equal(buildCashbook({ openingBalance: 0, openingDate: '2026-02-01', entries, to: '2026-02-05' }).closing, 5000);
});

test('budget: a voucher is over budget only when the head has a budget and too little is left', () => {
  assert.equal(budgetAvailable(100000, 20000, 50000), 30000);
  assert.equal(isOverBudget(100000, 20000, 50000, 30000), false);
  assert.equal(isOverBudget(100000, 20000, 50000, 30001), true);
  assert.equal(isOverBudget(null, 0, 0, 1e9), false);       // no budget set means no limit
});

test('amount in words, as written on a voucher', () => {
  assert.equal(amountWords(12500), 'Twelve thousand five hundred shillings only');
  assert.equal(amountWords(1000000), 'One million shillings only');
  assert.equal(amountWords(205), 'Two hundred and five shillings only');
  assert.equal(amountWords(45120.5), 'Forty-five thousand one hundred and twenty shillings and fifty cents only');
  assert.equal(amountWords(0), 'Zero shillings only');
});

test('statement: dates, numbers and columns are read the way Kenyan banks write them', () => {
  assert.equal(parseDate('05/10/2026'), '2026-10-05');
  assert.equal(parseDate('5-Oct-26'), '2026-10-05');
  assert.equal(parseDate('2026-10-05 10:11'), '2026-10-05');
  assert.equal(parseDate('nonsense'), null);
  assert.equal(parseNumber('1,250.50'), 1250.5);
  assert.equal(parseNumber('(300.00)'), -300);
  assert.equal(parseNumber(''), null);
  const a = readStatement('Account 123,,,\nDate,Description,Debit,Credit,Balance\n05/10/2026,"Deposit, QGH7ABC123",,"12,000.00",50000\n06/10/2026,Cheque 000123,3000.00,,47000\n');
  assert.deepEqual(a.lines.map((l) => [l.date, l.amount]), [['2026-10-05', 12000], ['2026-10-06', -3000]]);
  const b = readStatement('Date,Narrative,Amount\n2026-10-05,Salary,-8000\n2026-10-07,Fees,500\n');
  assert.deepEqual(b.lines.map((l) => l.amount), [-8000, 500]);
  assert.ok(readStatement('nothing useful here').error);
  assert.deepEqual(parseCsv('a,"b,c",d\n1,2,3\n')[0], ['a', 'b,c', 'd']);
});

test('reconciliation: a line matches one book entry by amount and date; a code settles a tie; entries are used once', () => {
  const entries = [
    { ref: 'payment:1', date: '2026-10-05', amount: 12000, text: 'Fees: Amara', code: 'RVS-000012' },
    { ref: 'payment:2', date: '2026-10-05', amount: 5000, text: 'Fees: Brian', code: 'QGH7AAA111' },
    { ref: 'payment:3', date: '2026-10-06', amount: 5000, text: 'Fees: Cara', code: 'QGH7BBB222' },
    { ref: 'expense:1', date: '2026-10-07', amount: -3000, text: 'Chalk', code: '000123' },
  ];
  const lines = [
    { id: 'l1', date: '2026-10-06', amount: 12000, text: 'DEPOSIT' },                       // one fit, one day apart
    { id: 'l2', date: '2026-10-06', amount: 5000, text: 'MPESA QGH7BBB222' },              // two fit, the code decides
    { id: 'l3', date: '2026-10-06', amount: 5000, text: 'DEPOSIT' },                       // the only 5,000 left: payment:1? no, payment:2 is free
    { id: 'l4', date: '2026-10-20', amount: -3000, text: 'CHQ 000123' },                  // too far apart
    { id: 'l5', date: '2026-10-07', amount: 777, text: 'unknown' },
  ];
  const m = Object.fromEntries(autoMatch(lines, entries).map((x) => [x.lineId, x.ref]));
  assert.equal(m.l1, 'payment:1');
  assert.equal(m.l2, 'payment:3');
  assert.equal(m.l3, 'payment:2');
  assert.ok(!m.l4 && !m.l5);
});

test('statement lines have a stable key, so re-importing the same statement adds nothing new', () => {
  const l = { date: '2026-10-05', amount: 12000, description: 'Deposit', reference: 'X1' };
  assert.equal(lineKey(l), lineKey({ ...l, description: ' DEPOSIT ' }));
  assert.notEqual(lineKey(l), lineKey({ ...l, amount: 12001 }));
});
