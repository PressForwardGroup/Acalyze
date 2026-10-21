import test from 'node:test';
import assert from 'node:assert/strict';
import { chargeApplies, isCleared } from '../src/lib/fees.js';

const item = (o) => ({ published: true, audience: 'all', grade: null, grades: null, ...o });
const kid = (o) => ({ grade: 'Grade 2', boarding: 'day', assigned: false, ...o });

test('fee structure: a draft charge never applies', () => {
  assert.equal(chargeApplies(item({ published: false }), kid()), false);
});
test('fee structure: a grade group applies only to those grades', () => {
  const tuition = item({ grades: ['Grade 1', 'Grade 2', 'Grade 3'] });
  assert.equal(chargeApplies(tuition, kid({ grade: 'Grade 2' })), true);
  assert.equal(chargeApplies(tuition, kid({ grade: 'Grade 5' })), false);
  assert.equal(chargeApplies(item({ grades: [] }), kid({ grade: 'Grade 5' })), true);   // empty list = every grade
});
test('fee structure: the old single-grade charge still works', () => {
  assert.equal(chargeApplies(item({ grade: 'Form 3' }), kid({ grade: 'Form 3' })), true);
  assert.equal(chargeApplies(item({ grade: 'Form 3' }), kid({ grade: 'Form 4' })), false);
});
test('fee structure: day and boarding charges follow the student', () => {
  assert.equal(chargeApplies(item({ audience: 'boarding' }), kid({ boarding: 'boarding' })), true);
  assert.equal(chargeApplies(item({ audience: 'boarding' }), kid({ boarding: 'day' })), false);
  assert.equal(chargeApplies(item({ audience: 'day' }), kid({ boarding: 'day' })), true);
});
test('fee structure: an optional charge (transport, a trip) applies only to students assigned to it', () => {
  const bus = item({ audience: 'optional' });
  assert.equal(chargeApplies(bus, kid({ assigned: true })), true);
  assert.equal(chargeApplies(bus, kid({ assigned: false })), false);
});
test('cleared: needs charges, and everything paid', () => {
  assert.equal(isCleared(15000, 15000), true);
  assert.equal(isCleared(15000, 20000), true);
  assert.equal(isCleared(15000, 14999), false);
  assert.equal(isCleared(0, 0), false);
});
