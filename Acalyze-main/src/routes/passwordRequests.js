import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { normPhone } from '../lib/parents.js';
import { sendEmail } from '../lib/mail.js';

export const passwordRequestsRouter = Router();

function tempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
}

// PUBLIC. Same reply every time, so it can't be used to discover which accounts exist.
// Body: { identifier } — an email (teacher/admin) or a phone number (parent).
passwordRequestsRouter.post('/forgot', asyncHandler(async (req, res) => {
  const idf = String(req.body.identifier || '').trim();
  if (!idf) return res.status(400).json({ error: 'Enter your email or phone number.' });

  let who = null;
  if (idf.includes('@')) {
    const email = idf.toLowerCase();
    const a = await query(`SELECT id, organization_id, full_name FROM admins WHERE lower(email) = $1`, [email]);
    if (a.rows[0]) who = { kind: 'admin', ...a.rows[0], ident: email };
    else {
      const t = await query(`SELECT id, organization_id, full_name FROM teachers WHERE lower(email) = $1`, [email]);
      if (t.rows[0]) who = { kind: 'teacher', ...t.rows[0], ident: email };
    }
  } else {
    const phone = normPhone(idf);
    const p = await query(`SELECT id, organization_id, full_name FROM parents WHERE phone = $1`, [phone]);
    if (p.rows.length === 1) who = { kind: 'parent', ...p.rows[0], full_name: p.rows[0].full_name || phone, ident: phone };
  }
  if (who) {
    const dupe = await query(`SELECT 1 FROM password_requests WHERE person_id = $1 AND kind = $2 AND status = 'PENDING'`, [who.id, who.kind]);
    if (!dupe.rows[0]) {
      await query(
        `INSERT INTO password_requests (organization_id, kind, person_id, identifier, full_name) VALUES ($1,$2,$3,$4,$5)`,
        [who.organization_id, who.kind, who.id, who.ident, who.full_name]);
    }
  }
  res.json({ ok: true, message: 'If that account exists, it has been reported. Your school admin (or the platform team, for school admin accounts) will give you a temporary password.' });
}));

// Pending requests. Platform admin: school-admin requests from every school.
// School admin: parent and teacher requests at their own school only.
passwordRequestsRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const cols = `r.id, r.kind, r.identifier, r.full_name, r.requested_at, o.name AS school_name`;
  if (req.auth.role === 'platform_admin') {
    const { rows } = await query(
      `SELECT ${cols} FROM password_requests r JOIN organizations o ON o.id = r.organization_id
       WHERE r.status = 'PENDING' AND r.kind = 'admin' ORDER BY r.requested_at DESC`);
    return res.json(rows);
  }
  if (req.auth.role === 'admin') {
    const { rows } = await query(
      `SELECT ${cols} FROM password_requests r JOIN organizations o ON o.id = r.organization_id
       WHERE r.status = 'PENDING' AND r.organization_id = $1 AND r.kind IN ('parent','teacher')
       ORDER BY r.requested_at DESC`, [req.auth.organizationId]);
    return res.json(rows);
  }
  res.status(403).json({ error: 'Not allowed' });
}));

// Set a temporary password (typed, or generated if empty). Parents and
// teachers must pick a new one at next sign-in.
passwordRequestsRouter.post('/:id/resolve', requireAuth, asyncHandler(async (req, res) => {
  const role = req.auth.role;
  if (role !== 'admin' && role !== 'platform_admin') return res.status(403).json({ error: 'Not allowed' });
  const q = (await query(`SELECT * FROM password_requests WHERE id = $1 AND status = 'PENDING'`, [req.params.id])).rows[0];
  if (!q) return res.status(404).json({ error: 'Request not found or already handled' });
  if (role === 'admin' && (q.kind === 'admin' || q.organization_id !== req.auth.organizationId)) {
    return res.status(403).json({ error: 'Only the platform team can reset this account.' });
  }
  if (role === 'platform_admin' && q.kind !== 'admin') {
    return res.status(403).json({ error: "That school's own admin handles this request." });
  }

  let pw = String(req.body.password || '').trim();
  if (pw && pw.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (!pw) pw = tempPassword();
  const hash = await hashPassword(pw);

  let sendTo = null, outro = 'You will be asked to choose a new password the first time you sign in.';
  if (q.kind === 'teacher') {
    await query(`UPDATE teachers SET password_hash = $1, must_change_password = true WHERE id = $2`, [hash, q.person_id]);
    sendTo = q.identifier;
  } else if (q.kind === 'parent') {
    await query(`UPDATE parents SET password_hash = $1, password_changed = false WHERE id = $2`, [hash, q.person_id]);
  } else {
    await query(`UPDATE admins SET password_hash = $1 WHERE id = $2`, [hash, q.person_id]);
    sendTo = q.identifier;
    outro = 'After signing in, open the profile menu and choose Password to set your own.';
  }
  await query(`UPDATE password_requests SET status = 'DONE', resolved_at = now() WHERE id = $1`, [q.id]);

  const site = process.env.APP_URL ? `\nSign in here: ${process.env.APP_URL}\n` : '\n';
  const emailed = await sendEmail(sendTo, 'Your Acalyze temporary password',
    `Hello,\n\nA temporary password has been set for your Acalyze account.\n\nSign in with: ${q.identifier}\nTemporary password: ${pw}\n${site}\n${outro}`);

  res.json({ ok: true, emailed, emailedTo: emailed ? sendTo : null, tempPassword: pw, kind: q.kind, identifier: q.identifier });
}));
