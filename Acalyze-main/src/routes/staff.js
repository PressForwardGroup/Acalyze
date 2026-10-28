import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { hashPassword } from '../lib/auth.js';
import { tempPassword } from '../lib/parents.js';
import { passwordProblem } from '../lib/password.js';
import { STAFF_KINDS, KIND_LABELS } from '../lib/permissions.js';
import { revokeSessions } from '../lib/sessions.js';
import { forgetFinanceAccess } from '../lib/financeAccess.js';
import { audit } from '../lib/audit.js';

// Staff accounts for one school: school admins and deputies, the principal, finance officers.
// Teachers and parents have their own screens. Accounts are switched off, never deleted, so records keep their author.
export const staffRouter = Router();
staffRouter.use(requireAuth, requirePerm('staff.manage'));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELDS = `id, full_name, email, role_kind, title, active, must_change_password, created_at`;

staffRouter.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT ${FIELDS} FROM admins WHERE organization_id = $1 ORDER BY role_kind, full_name`, [req.auth.organizationId]);
  res.json({ me: req.auth.sub, kinds: KIND_LABELS, staff: rows });
}));

staffRouter.post('/', asyncHandler(async (req, res) => {
  const fullName = String(req.body?.fullName || '').trim().slice(0, 100);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const kind = String(req.body?.kind || '');
  const title = String(req.body?.title || '').trim().slice(0, 60) || null;
  if (!fullName) return res.status(400).json({ error: 'Enter the person\'s name.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address. This is how they sign in.' });
  if (!STAFF_KINDS.includes(kind)) return res.status(400).json({ error: 'Choose the kind of account.' });
  const typed = String(req.body?.password || '');
  if (typed && passwordProblem(typed)) return res.status(400).json({ error: passwordProblem(typed) });
  const taken = await query(
    `SELECT 1 FROM admins WHERE lower(email) = $1 UNION SELECT 1 FROM teachers WHERE lower(email) = $1 UNION SELECT 1 FROM platform_admins WHERE lower(email) = $1`, [email]);
  if (taken.rows.length) return res.status(409).json({ error: `${email} is already used by another account.` });
  const password = typed || tempPassword();
  const { rows } = await query(
    `INSERT INTO admins (organization_id, full_name, email, password_hash, role_kind, title, must_change_password)
     VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING ${FIELDS}`,
    [req.auth.organizationId, fullName, email, await hashPassword(password), kind, title]);
  forgetFinanceAccess(req.auth.organizationId);
  await audit(req, { area: 'security', action: 'staff.create', entity: 'staff', entityId: rows[0].id, detail: { name: fullName, email, kind } });
  res.status(201).json({ ...rows[0], tempPassword: password });
}));

staffRouter.patch('/:id', asyncHandler(async (req, res) => {
  const org = req.auth.organizationId;
  const cur = (await query(`SELECT ${FIELDS} FROM admins WHERE id = $1 AND organization_id = $2`, [req.params.id, org])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Account not found.' });
  const b = req.body || {};
  const next = {
    full_name: 'fullName' in b ? String(b.fullName || '').trim().slice(0, 100) : cur.full_name,
    title: 'title' in b ? String(b.title || '').trim().slice(0, 60) || null : cur.title,
    role_kind: 'kind' in b ? String(b.kind) : cur.role_kind,
    active: 'active' in b ? b.active === true : cur.active,
  };
  if (!next.full_name) return res.status(400).json({ error: 'Enter the person\'s name.' });
  if (!STAFF_KINDS.includes(next.role_kind)) return res.status(400).json({ error: 'Choose the kind of account.' });
  const self = String(req.auth.sub) === String(cur.id);
  if (self && (next.role_kind !== cur.role_kind || next.active !== cur.active)) return res.status(400).json({ error: 'You cannot change your own role or switch yourself off.' });
  // A school must always keep at least one working school admin.
  const stopsBeingAdmin = cur.role_kind === 'admin' && cur.active && (next.role_kind !== 'admin' || !next.active);
  if (stopsBeingAdmin) {
    const others = await query(`SELECT 1 FROM admins WHERE organization_id = $1 AND role_kind = 'admin' AND active AND id <> $2 LIMIT 1`, [org, cur.id]);
    if (!others.rows.length) return res.status(400).json({ error: 'A school needs at least one working school admin account.' });
  }
  const { rows } = await query(
    `UPDATE admins SET full_name = $1, title = $2, role_kind = $3, active = $4 WHERE id = $5 AND organization_id = $6 RETURNING ${FIELDS}`,
    [next.full_name, next.title, next.role_kind, next.active, cur.id, org]);
  forgetFinanceAccess(org);
  if (!next.active || next.role_kind !== cur.role_kind) await revokeSessions(cur.id);   // they must sign in again with their new access
  await audit(req, { area: 'security', action: 'staff.update', entity: 'staff', entityId: cur.id, detail: { name: next.full_name, from: { kind: cur.role_kind, active: cur.active }, to: { kind: next.role_kind, active: next.active } } });
  res.json(rows[0]);
}));

staffRouter.post('/:id/reset-password', asyncHandler(async (req, res) => {
  const org = req.auth.organizationId;
  const cur = (await query(`SELECT id, full_name, email FROM admins WHERE id = $1 AND organization_id = $2`, [req.params.id, org])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Account not found.' });
  if (String(req.auth.sub) === String(cur.id)) return res.status(400).json({ error: 'Use "Password" in the menu to change your own password.' });
  const typed = String(req.body?.password || '');
  if (typed && passwordProblem(typed)) return res.status(400).json({ error: passwordProblem(typed) });
  const password = typed || tempPassword();
  await query(`UPDATE admins SET password_hash = $1, must_change_password = true WHERE id = $2`, [await hashPassword(password), cur.id]);
  await revokeSessions(cur.id);
  await audit(req, { area: 'security', action: 'staff.reset_password', entity: 'staff', entityId: cur.id, detail: { name: cur.full_name } });
  res.json({ email: cur.email, tempPassword: password });
}));
