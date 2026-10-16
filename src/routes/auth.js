import { Router } from 'express';
import { query } from '../lib/db.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from '../lib/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { featuresForOrg } from '../lib/plans.js';
import { orgIsActive } from '../lib/orgStatus.js';

export const authRouter = Router();

function claimsFrom(req, res) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  try { return verifyToken(t); }
  catch { res.status(401).json({ error: 'Session expired, please sign in again' }); return null; }
}

async function blockIfSuspended(res, organizationId) {
  if (await orgIsActive(organizationId)) return false;
  res.status(403).json({ error: "This school's account is not active. Please contact Acalyze support." });
  return true;
}

function normPhone(raw) {
  // Keeps leading + if present, strips everything else non-digit. Not a
  // full phone-number library — good enough to match what a parent typed
  // against what an admin entered when adding them.
  return String(raw || '').trim().replace(/[^\d+]/g, '');
}

// ---------- UNIFIED LOGIN ----------
// "@" in the identifier -> staff (platform admin, school admin, or teacher). Otherwise -> parent, by phone number. There is no
// student login — students never sign in to Acalyze.
authRouter.post('/login', asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) return res.status(400).json({ error: 'Enter your email or phone number, and password.' });
  const id = identifier.trim();
  const bad = () => res.status(401).json({ error: 'Incorrect email/phone or password' });

  if (id.includes('@')) {
    const email = id.toLowerCase();

    const pa = await query(`SELECT id, full_name, password_hash FROM platform_admins WHERE email = $1`, [email]);
    if (pa.rows[0] && await verifyPassword(password, pa.rows[0].password_hash)) {
      const token = signToken({ sub: pa.rows[0].id, role: 'platform_admin', organizationId: null });
      return res.json({ kind: 'platform_admin', token, name: pa.rows[0].full_name });
    }

    const a = await query(
      `SELECT a.id, a.organization_id, a.full_name, a.password_hash, o.name AS org_name
       FROM admins a JOIN organizations o ON o.id = a.organization_id WHERE a.email = $1`, [email]);
    if (a.rows[0] && await verifyPassword(password, a.rows[0].password_hash)) {
      const admin = a.rows[0];
      if (await blockIfSuspended(res, admin.organization_id)) return;
      const token = signToken({ sub: admin.id, role: 'admin', organizationId: admin.organization_id });
      return res.json({ kind: 'admin', token, admin: { id: admin.id, name: admin.full_name, organization: admin.org_name } });
    }

    // Individual teacher account — email + their own password.
    const pt = await query(
      `SELECT id, organization_id, center_id, full_name, section, password_hash, must_change_password
       FROM teachers WHERE lower(email) = $1`, [email]);
    if (pt.rows[0] && pt.rows[0].password_hash && await verifyPassword(password, pt.rows[0].password_hash)) {
      const t = pt.rows[0];
      if (await blockIfSuspended(res, t.organization_id)) return;
      if (t.must_change_password) {
        const resetToken = signToken({ sub: t.id, role: 'teacher_reset', organizationId: t.organization_id, centerId: t.center_id });
        return res.json({ kind: 'teacher', needsPasswordChange: true, resetToken });
      }
      const token = signToken({ sub: t.id, role: 'teacher', organizationId: t.organization_id, centerId: t.center_id, section: t.section });
      return res.json({ kind: 'teacher', token, teacher: { id: t.id, full_name: t.full_name, section: t.section } });
    }
    return bad();
  }

  // Parent login by phone. Phone is unique per-organization, not globally,
  // so a coincidental match in two unrelated schools is theoretically
  // possible — extremely unlikely, and handled by trying each match's
  // password rather than assuming the first row is right.
  const phone = normPhone(id);
  const candidates = await query(
    `SELECT id, organization_id, full_name, password_hash, password_changed FROM parents WHERE phone = $1`, [phone]);
  let parent = null;
  for (const row of candidates.rows) {
    if (await verifyPassword(password, row.password_hash)) { parent = row; break; }
  }
  if (!parent) return bad();
  if (await blockIfSuspended(res, parent.organization_id)) return;
  if (!(await featuresForOrg(parent.organization_id)).parents) {
    return res.status(402).json({ error: "Parent accounts aren't included in your school's plan. Please contact the school." });
  }

  if (!parent.password_changed) {
    const resetToken = signToken({ sub: parent.id, role: 'parent_reset', organizationId: parent.organization_id });
    return res.json({ kind: 'parent', needsPasswordChange: true, resetToken });
  }
  const token = signToken({ sub: parent.id, role: 'parent', organizationId: parent.organization_id });
  res.json({ kind: 'parent', token, parent: { id: parent.id, name: parent.full_name } });
}));

// Forced first-login password change (parents and teachers — each has their own
// password, set by the admin as a temporary one).
authRouter.post('/set-password', asyncHandler(async (req, res) => {
  const { resetToken, newPassword } = req.body;
  if (!resetToken || !newPassword) return res.status(400).json({ error: 'resetToken and newPassword are required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  let claims;
  try { claims = verifyToken(resetToken); }
  catch { return res.status(401).json({ error: 'Session expired, please sign in again' }); }
  const hash = await hashPassword(newPassword);
  if (claims.role === 'teacher_reset') {
    const { rows } = await query(
      `UPDATE teachers SET password_hash = $1, must_change_password = false WHERE id = $2
       RETURNING id, organization_id, center_id, full_name, section`, [hash, claims.sub]);
    if (!rows[0]) return res.status(404).json({ error: 'Teacher not found' });
    const t = rows[0];
    const token = signToken({ sub: t.id, role: 'teacher', organizationId: t.organization_id, centerId: t.center_id, section: t.section });
    return res.json({ kind: 'teacher', token, teacher: { id: t.id, full_name: t.full_name, section: t.section } });
  }
  if (claims.role !== 'parent_reset') return res.status(401).json({ error: 'Invalid reset token' });
  await query(`UPDATE parents SET password_hash = $1, password_changed = true WHERE id = $2`, [hash, claims.sub]);
  const token = signToken({ sub: claims.sub, role: 'parent', organizationId: claims.organizationId });
  res.json({ kind: 'parent', token });
}));

// ---------- PLATFORM ADMIN: switch into an org ----------
// Mirrors MOHI's old it_support/switch-center, but explicit and scoped:
// a platform_admin must actively choose to view one org at a time, and the
// resulting token behaves as role 'admin' for that org only — it does not
// retain standing access to every org the way MOHI's it_support did.
authRouter.post('/platform/view-org', asyncHandler(async (req, res) => {
  const c = claimsFrom(req, res); if (!c) return;
  if (c.role !== 'platform_admin') return res.status(403).json({ error: 'Platform admin only' });
  const { organizationId } = req.body;
  if (!organizationId) return res.status(400).json({ error: 'organizationId is required' });
  const org = await query(`SELECT id, name FROM organizations WHERE id = $1`, [organizationId]);
  if (!org.rows[0]) return res.status(404).json({ error: 'Organization not found' });
  const token = signToken({ sub: c.sub, role: 'admin', organizationId, actingAsPlatformAdmin: true });
  res.json({ token, organization: org.rows[0] });
}));

// ---------- PROFILE ----------
authRouter.get('/me', asyncHandler(async (req, res) => {
  const c = claimsFrom(req, res); if (!c) return;

  if (c.role === 'platform_admin') {
    const { rows } = await query(`SELECT full_name, email FROM platform_admins WHERE id = $1`, [c.sub]);
    if (!rows[0]) return res.status(404).json({ error: 'Account not found' });
    return res.json({ id: c.sub, name: rows[0].full_name, email: rows[0].email, roleLabel: 'Platform Admin' });
  }
  if (c.role === 'admin' && c.actingAsPlatformAdmin) {
    // A platform admin opened this school to help: there is no admins row for them.
    const org = await query(`SELECT name FROM organizations WHERE id = $1`, [c.organizationId]);
    if (!org.rows[0]) return res.status(404).json({ error: 'School not found' });
    return res.json({ id: c.sub, name: 'Acalyze support', organization: org.rows[0].name, roleLabel: 'School Admin', actingAsPlatformAdmin: true });
  }
  if (c.role === 'admin') {
    const { rows } = await query(
      `SELECT a.full_name, a.email, o.name AS org FROM admins a JOIN organizations o ON o.id = $2 WHERE a.id = $1`,
      [c.sub, c.organizationId]);
    if (!rows[0]) return res.status(404).json({ error: 'Account not found' });
    return res.json({ id: c.sub, name: rows[0].full_name, email: rows[0].email, organization: rows[0].org, roleLabel: 'School Admin', actingAsPlatformAdmin: !!c.actingAsPlatformAdmin });
  }
  if (c.role === 'teacher') {
    const { rows } = await query(
      `SELECT t.full_name, t.phone, t.section, ce.name AS center FROM teachers t LEFT JOIN centers ce ON ce.id = t.center_id WHERE t.id = $1`,
      [c.sub]);
    if (!rows[0]) return res.status(404).json({ error: 'Account not found' });
    return res.json({ id: c.sub, name: rows[0].full_name, phone: rows[0].phone, section: rows[0].section, center: rows[0].center, roleLabel: 'Teacher' });
  }
  if (c.role === 'parent') {
    const { rows } = await query(`SELECT full_name, phone FROM parents WHERE id = $1`, [c.sub]);
    if (!rows[0]) return res.status(404).json({ error: 'Account not found' });
    return res.json({ id: c.sub, name: rows[0].full_name, phone: rows[0].phone, roleLabel: 'Parent' });
  }
  return res.status(403).json({ error: 'Not available for this account' });
}));

authRouter.post('/change-password', asyncHandler(async (req, res) => {
  const c = claimsFrom(req, res); if (!c) return;
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Enter your current and new password.' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const table = { platform_admin: 'platform_admins', admin: 'admins', teacher: 'teachers', parent: 'parents' }[c.role];
  if (!table) return res.status(403).json({ error: 'Not available for this account' });
  const { rows } = await query(`SELECT password_hash FROM ${table} WHERE id = $1`, [c.sub]);
  if (!rows[0]) return res.status(404).json({ error: 'Account not found' });
  if (!(await verifyPassword(currentPassword, rows[0].password_hash)))
    return res.status(401).json({ error: 'Current password is incorrect' });
  await query(`UPDATE ${table} SET password_hash = $1 WHERE id = $2`, [await hashPassword(newPassword), c.sub]);
  res.json({ ok: true });
}));
