import test from 'node:test';
import assert from 'node:assert/strict';
import { allocatePayments, rollupBy, summarizeBalances, chargeOrder } from '../src/lib/fees.js';

const charges = [
  { name: 'Lunch', vote_head: 'Lunch', term: 'Term 2', due_date: '2026-05-01', amount: 3000 },
  { name: 'Tuition', vote_head: 'Tuition', term: 'Term 1', due_date: '2026-01-20', amount: 15000 },
  { name: 'Development', vote_head: 'Development', term: null, due_date: null, amount: 2000 },
  { name: 'Tuition', vote_head: 'Tuition', term: 'Term 2', due_date: '2026-05-01', amount: 15000 },
];

test('allocation: whole-year charges first, then Term 1, then Term 2, oldest first', () => {
  const order = [...charges].sort(chargeOrder).map((c) => `${c.term || 'year'}:${c.name}`);
  assert.deepEqual(order, ['year:Development', 'Term 1:Tuition', 'Term 2:Lunch', 'Term 2:Tuition']);
});

test('allocation: a payment fills the oldest charges first and the rest stays owing', () => {
  const { lines, credit } = allocatePayments(charges, 20000);
  assert.deepEqual(lines.map((l) => [l.name, l.paid, l.balance]), [['Development', 2000, 0], ['Tuition', 15000, 0], ['Lunch', 3000, 0], ['Tuition', 0, 15000]]);
  assert.equal(credit, 0);
});

test('allocation: money beyond all the charges is a credit', () => {
  const { lines, credit } = allocatePayments(charges, 40000);
  assert.ok(lines.every((l) => l.balance === 0));
  assert.equal(credit, 5000);
});

test('allocation: no payment means everything is owed; pennies do not drift', () => {
  const { lines, credit } = allocatePayments([{ name: 'A', term: null, amount: 100.1 }, { name: 'B', term: null, amount: 200.2 }], 0.3);
  assert.equal(credit, 0);
  assert.equal(lines.reduce((n, l) => n + l.paid, 0), 0.3);
  assert.equal(allocatePayments(charges, 0).lines.every((l) => l.paid === 0), true);
});

test('roll-up: totals by vote head and by term add up to the whole', () => {
  const { lines } = allocatePayments(charges, 20000);
  const byHead = rollupBy(lines, (l) => l.vote_head || l.name);
  assert.equal(byHead.find((h) => h.key === 'Tuition').charged, 30000);
  assert.equal(byHead.find((h) => h.key === 'Tuition').paid, 15000);
  assert.equal(byHead.reduce((n, h) => n + h.paid, 0), 20000);
  const byTerm = rollupBy(lines, (l) => l.term || 'Whole year');
  assert.equal(byTerm.find((t) => t.key === 'Term 2').balance, 15000);
});

test('summary: one student overpaying does not hide what another owes', () => {
  const s = summarizeBalances([{ charged: 10000, paid: 15000, class_name: 'A' }, { charged: 10000, paid: 5000, class_name: 'A' }]);
  assert.equal(s.outstanding, 5000);
  assert.equal(s.credits, 5000);
  assert.equal(s.studentsOwing, 1);
  assert.equal(s.studentsInCredit, 1);
  assert.equal(s.collectionRate, 75);      // 10,000 + 5,000 counted towards 20,000 of charges
});

import { isCleared, overdueSummary, ageBucket, refundable } from '../src/lib/fees.js';

test('waivers: a bursary covers the oldest charges first, then payments cover what is left', () => {
  const { lines, credit } = allocatePayments(charges, 6000, 20000);   // 20,000 waived, 6,000 paid
  assert.deepEqual(lines.map((l) => [l.name, l.waived, l.paid, l.balance]), [['Development', 2000, 0, 0], ['Tuition', 15000, 0, 0], ['Lunch', 3000, 0, 0], ['Tuition', 0, 6000, 9000]]);
  assert.equal(credit, 0);
  const all = allocatePayments(charges, 0, 99999);                      // a waiver can never go beyond the charges
  assert.ok(all.lines.every((l) => l.balance === 0 && l.waived === l.amount));
});

test('waivers: roll-ups and the summary keep waived apart from paid', () => {
  const { lines } = allocatePayments(charges, 5000, 2000);
  const head = rollupBy(lines, (l) => l.vote_head || l.name);
  assert.equal(head.reduce((n, h) => n + h.waived, 0), 2000);
  assert.equal(head.reduce((n, h) => n + h.paid, 0), 5000);
  assert.equal(summarizeBalances([{ charged: 8000, waived: 2000, paid: 5000, class_name: 'A' }]).waived, 2000);
});

test('cleared: a student whose fees were fully waived counts as cleared', () => {
  assert.equal(isCleared(0, 0, 15000), true);
  assert.equal(isCleared(0, 0, 0), false);
  assert.equal(isCleared(10000, 9999, 15000), false);
});

test('ageing: only charges past their due date are overdue, and the oldest one sets the bucket', () => {
  const lines = [{ balance: 5000, due_date: '2026-08-01' }, { balance: 3000, due_date: '2026-09-25' }, { balance: 4000, due_date: '2026-12-01' }, { balance: 2000, due_date: null }, { balance: 0, due_date: '2026-01-01' }];
  const o = overdueSummary(lines, '2026-10-20');
  assert.deepEqual([o.overdue, o.oldest, o.days, o.bucket], [8000, '2026-08-01', 80, 'd61_90']);
  assert.equal(overdueSummary([{ balance: 100, due_date: '2026-12-01' }], '2026-10-20').bucket, 'current');
  assert.deepEqual([0, 1, 30, 31, 60, 61, 90, 91].map(ageBucket), ['current', 'd1_30', 'd1_30', 'd31_60', 'd31_60', 'd61_90', 'd61_90', 'd90plus']);
});

test('refunds: only money beyond what is owed can be refunded, less refunds already asked for', () => {
  assert.equal(refundable(10000, 15000), 5000);
  assert.equal(refundable(10000, 15000, 2000), 3000);
  assert.equal(refundable(10000, 8000), 0);
  assert.equal(refundable(10000, 15000, 9999), 0);
});
