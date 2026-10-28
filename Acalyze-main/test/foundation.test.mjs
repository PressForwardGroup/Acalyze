import test from 'node:test';
import assert from 'node:assert/strict';
import { can, permissionsFor, roleAllowed } from '../src/lib/permissions.js';
import { MODULES, MODULE_KEYS, normalizeModules } from '../src/lib/modules.js';
import { passwordProblem } from '../src/lib/password.js';
import { deciderProblem, needsApproval } from '../src/lib/approvals.js';
import { tokenIsOlder } from '../src/lib/sessions.js';

test('roles: finance is for the principal and finance officer only; the school admin never sees it', () => {
  assert.ok(can('principal', 'finance.edit') && can('finance', 'finance.edit'));
  assert.ok(!can('admin', 'finance.view') && !can('teacher', 'finance.view') && !can('parent', 'finance.view'));
  assert.deepEqual(permissionsFor('finance').filter((p) => p.startsWith('academic')), []);
});

test('roles: only the principal approves; admins and the principal manage staff', () => {
  assert.ok(can('principal', 'finance.approve'));
  assert.ok(!can('finance', 'finance.approve') && !can('admin', 'finance.approve'));
  assert.ok(can('admin', 'staff.manage') && can('principal', 'staff.manage') && !can('finance', 'staff.manage'));
  assert.ok(!can('admin', 'audit.view_finance'));
});

test('guards: the principal reads what an admin can, but cannot change it', () => {
  assert.ok(roleAllowed('principal', ['admin'], 'GET'));
  assert.ok(!roleAllowed('principal', ['admin'], 'POST'));
  assert.ok(!roleAllowed('principal', ['teacher'], 'GET'));
  assert.ok(roleAllowed('admin', ['admin'], 'DELETE'));
});

test('guards: the finance officer can list classes and students and nothing else academic', () => {
  assert.ok(roleAllowed('finance', ['admin'], 'GET', '/classes', '/'));
  assert.ok(roleAllowed('finance', ['admin'], 'GET', '/students', '/'));
  assert.ok(!roleAllowed('finance', ['admin'], 'GET', '/marks', '/'));
  assert.ok(!roleAllowed('finance', ['admin'], 'POST', '/students', '/'));
  assert.ok(!roleAllowed('finance', ['admin'], 'GET', '/students', '/abc'));
});

test('modules: every module has a unique key, and unknown keys are dropped', () => {
  assert.equal(new Set(MODULE_KEYS).size, MODULES.length);
  const m = normalizeModules({ fees: true, analytics: true, hacker: true });
  assert.equal(m.fees, true); assert.equal(m.parents, false); assert.ok(!('hacker' in m));
  assert.equal(normalizeModules(null), null);
  assert.throws(() => normalizeModules([1]));
});

test('passwords: at least 8 characters with a letter and a number', () => {
  assert.ok(passwordProblem('abc123'));
  assert.ok(passwordProblem('abcdefgh'));
  assert.ok(passwordProblem('12345678'));
  assert.ok(passwordProblem('Password1'));
  assert.equal(passwordProblem('Maths2026!'), null);
});

test('approvals: only the principal decides, never on their own request, never twice', () => {
  const row = { status: 'pending', requested_by_id: 'f1' };
  assert.equal(deciderProblem(row, { role: 'principal', sub: 'p1' }), null);
  assert.ok(deciderProblem(row, { role: 'finance', sub: 'f2' }));
  assert.ok(deciderProblem(row, { role: 'principal', sub: 'f1' }));
  assert.ok(deciderProblem({ ...row, status: 'approved' }, { role: 'principal', sub: 'p1' }));
  assert.ok(deciderProblem(null, { role: 'principal', sub: 'p1' }));
  assert.ok(needsApproval('finance') && !needsApproval('principal'));
});

test('sessions: a token made before "sign out everywhere" stops working, a fresh one does not', () => {
  const resetAt = Date.parse('2026-10-20T10:00:30.500Z');
  const at = (s) => Math.floor(Date.parse(s) / 1000);
  assert.ok(tokenIsOlder({ iat: at('2026-10-20T09:00:00Z') }, resetAt));
  assert.ok(!tokenIsOlder({ iat: at('2026-10-20T10:00:30Z') }, resetAt));
  assert.ok(!tokenIsOlder({ iat: at('2026-10-20T10:05:00Z') }, resetAt));
  assert.ok(!tokenIsOlder({ iat: at('2026-10-20T09:00:00Z') }, 0));
});
