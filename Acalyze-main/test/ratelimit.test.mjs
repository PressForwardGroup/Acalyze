import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../src/lib/rateLimit.js';

test('blocks after the limit, per IP, with Retry-After', () => {
  const rl = rateLimit({ max: 3 }); let passed = 0, blocked = 0, retry = null;
  for (let i = 0; i < 5; i++) rl({ ip: '1.2.3.4', headers: {} }, { set: (k, v) => (retry = v), status() { return this; }, json() { blocked++; } }, () => passed++);
  let other = 0; rl({ ip: '9.9.9.9', headers: {} }, { set() {}, status() { return this; }, json() {} }, () => other++);
  assert.deepEqual([passed, blocked, other], [3, 2, 1]); assert.ok(retry);
});
