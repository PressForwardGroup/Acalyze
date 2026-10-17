import test from 'node:test';
import assert from 'node:assert/strict';
import { flagsFor, levelFor, RULES } from '../src/lib/risk.js';

const h = (name, score, extra = {}) => ({ examName: name, score, eligible: true, subjectsDone: 7, subjects: {}, ...extra });
const kinds = (f) => f.map((x) => x.kind).sort();

test('levels follow the total weight of the flags', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 8].map(levelFor), ['ok', 'watch', 'watch', 'medium', 'medium', 'high', 'high']);
});
test('no marks at all is a single high-severity flag', () => {
  const f = flagsFor({ history: [h('T3', null, { subjectsDone: 0, eligible: false }), h('T2', 60)] });
  assert.deepEqual(kinds(f), ['missed']); assert.equal(f[0].severity, 'high');
});
test('a drop of 10+ is medium, 15+ is high, and improving or small changes are not flagged', () => {
  assert.equal(flagsFor({ history: [h('T3', 60), h('T2', 71)] })[0].severity, 'medium');
  assert.equal(flagsFor({ history: [h('T3', 55), h('T2', 71)] })[0].severity, 'high');
  assert.deepEqual(flagsFor({ history: [h('T3', 65), h('T2', 71)] }), []);
  assert.deepEqual(flagsFor({ history: [h('T3', 80), h('T2', 60)] }), []);
});
test('three exams in a row going down is flagged; a plateau is not', () => {
  assert.ok(kinds(flagsFor({ history: [h('T3', 60), h('T2', 66), h('T1', 72)] })).includes('streak'));
  assert.ok(!kinds(flagsFor({ history: [h('T3', 66), h('T2', 66), h('T1', 72)] })).includes('streak'));
});
test('below the KCPE-based target only applies to 8-4-4 and only when well below', () => {
  assert.ok(kinds(flagsFor({ history: [h('T3', 60)], kcpe: 450, scheme: '844' })).includes('target'));
  assert.ok(!kinds(flagsFor({ history: [h('T3', 60)], kcpe: 450, scheme: 'cbc' })).includes('target'));
  assert.ok(!kinds(flagsFor({ history: [h('T3', 60)], kcpe: 330, scheme: '844' })).includes('target'));
});
test('weak subjects and a sharp subject fall are named', () => {
  const subj = (a, b, c) => ({ M: { name: 'Maths', percent: a }, E: { name: 'English', percent: b }, K: { name: 'Kiswahili', percent: c } });
  assert.match(flagsFor({ history: [h('T3', 50, { subjects: subj(20, 25, 28) })] }).find((f) => f.kind === 'weak').text, /3 subjects under 30%: Maths, English, Kiswahili/);
  const f = flagsFor({ history: [h('T3', 55, { subjects: subj(38, 70, 70) }), h('T2', 60, { subjects: subj(70, 70, 70) })] });
  assert.match(f.find((x) => x.kind === 'subject').text, /Maths fell 32 points to 38%/);
});
test('bottom 10% needs enough ranked students to mean anything', () => {
  assert.ok(kinds(flagsFor({ history: [h('T3', 40)], position: 95, rankedCount: 100 })).includes('bottom'));
  assert.ok(!kinds(flagsFor({ history: [h('T3', 40)], position: 5, rankedCount: 5 })).includes('bottom'));
});
test('an incomplete result is a low flag, not a missing one', () => {
  const f = flagsFor({ history: [h('T3', null, { eligible: false, subjectsDone: 4 })] });
  assert.deepEqual(kinds(f), ['incomplete']); assert.equal(f[0].severity, 'low');
});
test('thresholds are exposed so they can be tuned in one place', () => assert.equal(RULES.bigDrop, 10));
