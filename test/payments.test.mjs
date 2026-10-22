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
