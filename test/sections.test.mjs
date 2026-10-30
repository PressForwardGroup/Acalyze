import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSections, normalizeSections } from '../src/lib/sections.js';

const ALL = ['PRIMARY', 'JUNIOR', 'SENIOR'];

test('Postgres sends an enum array back as text; it becomes a real list', () => {
  assert.deepEqual(parseSections('{PRIMARY,JUNIOR,SENIOR}'), ALL);
  assert.deepEqual(parseSections('{JUNIOR}'), ['JUNIOR']);
  assert.deepEqual(parseSections('{"SENIOR","PRIMARY"}'), ['PRIMARY', 'SENIOR']);
  assert.ok(Array.isArray(parseSections('{PRIMARY}')), 'always a list, so .map and .includes work');
});
test('a list passes through, and anything unusable means all sections (never an empty school)', () => {
  assert.deepEqual(parseSections(['SENIOR']), ['SENIOR']);
  for (const bad of [null, undefined, '', '{}', 'nonsense', [], 42]) assert.deepEqual(parseSections(bad), ALL);
});
test('choosing sections: at least one, only real ones, always in the same order', () => {
  assert.deepEqual(normalizeSections(['senior', 'primary']), ['PRIMARY', 'SENIOR']);
  assert.throws(() => normalizeSections([]), /at least one/i);
  assert.throws(() => normalizeSections(['COLLEGE']), /Unknown section/);
});
