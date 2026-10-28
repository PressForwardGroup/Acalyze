import test from 'node:test';
import assert from 'node:assert/strict';
import { validDay, rate, summarize, daysAgo, today, STATUSES } from '../src/lib/attendance.js';
import { parseAmount, balance, receiptNumber, summarizeBalances } from '../src/lib/fees.js';

const NOW = new Date('2026-10-16T09:00:00Z');
test('attendance days: real dates only, and not far in the future', () => {
  assert.equal(validDay('2026-10-16', NOW), '2026-10-16'); assert.equal(validDay('2026-10-17', NOW), '2026-10-17');
  assert.equal(validDay('2026-10-18', NOW), null); assert.equal(validDay('2026-02-30', NOW), null);
  assert.equal(validDay('16/10/2026', NOW), null); assert.equal(validDay('', NOW), null); assert.equal(validDay(undefined, NOW), null);
});
test('date helpers', () => { assert.equal(today(NOW), '2026-10-16'); assert.equal(daysAgo(30, NOW), '2026-09-16'); });
test('attendance rate counts late as attending, excused and absent as not, and is null with no records', () => {
  assert.equal(rate({ present: 8, late: 1, absent: 1 }), 90); assert.equal(rate({ present: 1, excused: 1 }), 50); assert.equal(rate({}), null);
});
test('summarize ignores unknown statuses', () => {
  const s = summarize([{ status: 'present' }, { status: 'late' }, { status: 'absent' }, { status: 'bogus' }]);
  assert.deepEqual([s.present, s.late, s.absent, s.total], [1, 1, 1, 4]); assert.deepEqual(STATUSES, ['present', 'absent', 'late', 'excused']);
});
test('money input: positive, comma-tolerant, rounded to 2 places, and sane', () => {
  assert.equal(parseAmount('12,500'), 12500); assert.equal(parseAmount('99.999'), 100); assert.equal(parseAmount(0), null);
  assert.equal(parseAmount(-5), null); assert.equal(parseAmount('abc'), null); assert.equal(parseAmount(''), null); assert.equal(parseAmount(1e12), null);
});
test('balances avoid floating-point noise', () => { assert.equal(balance(0.3, 0.1), 0.2); assert.equal(balance(1000, 1000), 0); assert.equal(balance(1000, 1200), -200); });
test('receipt numbers carry the school code and sort correctly', () => { assert.equal(receiptNumber('RVS', 7), 'RVS-000007'); assert.equal(receiptNumber('RVS', 123456), 'RVS-123456'); });
test('fee summary: totals, owing count, per-class rates, an overpayment is a credit and never hides what others owe', () => {
  const s = summarizeBalances([
    { class_name: 'Form 3 West', charged: 10000, paid: 10000 }, { class_name: 'Form 3 West', charged: 10000, paid: 4000 },
    { class_name: 'Form 3 East', charged: 10000, paid: 12000 }, { class_name: null, charged: 0, paid: 0 }]);
  assert.deepEqual([s.charged, s.collected, s.outstanding, s.studentsOwing, s.students], [30000, 26000, 6000, 1, 4]);
  assert.equal(s.credits, 2000);
  assert.equal(s.collectionRate, 80);   // money counted towards charges: 10,000 + 4,000 + 10,000 of 30,000
  const west = s.byClass.find((c) => c.class_name === 'Form 3 West'); assert.deepEqual([west.balance, west.rate], [6000, 70]);
  assert.ok(s.byClass.some((c) => c.class_name === '(no class)'));
  assert.equal(summarizeBalances([]).collectionRate, null);
});
