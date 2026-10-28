import crypto from 'crypto';
import { query } from './db.js';
import { hashPassword } from './auth.js';
import { featuresForOrg } from './plans.js';

export function normPhone(raw) {
  return String(raw || '').trim().replace(/[^\d+]/g, '');
}

// Readable temporary password, e.g. "Kx7m-92Qa". No ambiguous characters.
export function tempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const pick = (n) => Array.from(crypto.randomBytes(n), (b) => chars[b % chars.length]).join('');
  return `${pick(4)}-${pick(4)}`;
}

// Find-or-create the parent account for a phone number inside ONE
// organization, and link it to the student. One parent can have several
// children (siblings share a phone). Returns the temp password ONLY when a
// brand-new account was created, so the admin can hand it over (SMS delivery
// is not wired up yet).
export async function linkParent({ organizationId, studentId, parentName, parentPhone }) {
  const phone = normPhone(parentPhone);
  if (!phone) return null;
  // Schools on a plan without parent accounts keep the student record, just no parent login.
  if (!(await featuresForOrg(organizationId)).parents) return null;
  let parent = (await query(
    `SELECT id FROM parents WHERE organization_id = $1 AND phone = $2`, [organizationId, phone])).rows[0];
  let created = null;
  if (!parent) {
    const pw = tempPassword();
    parent = (await query(
      `INSERT INTO parents (organization_id, full_name, phone, password_hash) VALUES ($1,$2,$3,$4) RETURNING id`,
      [organizationId, parentName || null, phone, await hashPassword(pw)])).rows[0];
    created = { phone, tempPassword: pw };
  }
  await query(
    `INSERT INTO parent_students (parent_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [parent.id, studentId]);
  return created;
}
