import crypto from 'node:crypto';
import { query } from './db.js';
import { decryptSecret } from './secrets.js';
import { insertPayment } from './payments.js';
import { parseC2B, parseStkCallback } from './daraja.js';

// ---- the school's settings and callback addresses ----
export const getSettings = async (org) => (await query(`SELECT * FROM mpesa_settings WHERE organization_id = $1`, [org])).rows[0] || null;

export const credsFrom = (row) => ({
  env: row.env, shortcode: row.shortcode,
  consumerKey: decryptSecret(row.consumer_key_enc), consumerSecret: decryptSecret(row.consumer_secret_enc), passkey: decryptSecret(row.passkey_enc),
});

// Safaricom posts to these. The path holds a secret token only this school's Paybill knows.
// (Safaricom rejects addresses that contain words like "mpesa", so the path avoids them. The token is hex.)
export function hookUrls(org, token) {
  const base = (process.env.APP_URL || '').replace(/\/+$/, '');
  if (!base) return null;
  const root = `${base}/pay-hooks/${org}/${token}`;
  return { stk: `${root}/stk`, confirm: `${root}/confirm`, validate: `${root}/validate` };
}
export const newHookToken = () => crypto.randomBytes(24).toString('hex');

export function tokenMatches(given, expected) {
  const a = Buffer.from(String(given || '')), b = Buffer.from(String(expected || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

// ---- matching a payment to a student by the account number the parent typed ----
// "rvs 001", "RVS-001" and "rvs001" are all the same admission number.
export const normalizeRef = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function findStudentByRef(org, ref) {
  const key = normalizeRef(ref);
  if (!key) return null;
  const { rows } = await query(
    `SELECT id FROM students WHERE organization_id = $1 AND status = 'active' AND regexp_replace(upper(school_id_number), '[^A-Z0-9]', '', 'g') = $2 LIMIT 2`, [org, key]);
  return rows.length === 1 ? rows[0].id : null;   // two students with the same number are not guessed
}

// Turns a transaction into a recorded payment, exactly once.
export async function postToStudent(txnId, studentId, { amount = null, recordedById = null } = {}) {
  const t = (await query(
    `UPDATE mpesa_transactions SET status = 'paid', student_id = $2, completed_at = now()
     WHERE id = $1 AND payment_id IS NULL AND status IN ('pending','unmatched','claimed') RETURNING *`, [txnId, studentId])).rows[0];
  if (!t) return null;   // already posted by someone else
  try {
    const pay = await insertPayment({ org: t.organization_id, studentId, amount: amount ?? Number(t.amount), method: 'mpesa', reference: t.trans_id, note: 'M-Pesa', recordedById });
    await query(`UPDATE mpesa_transactions SET payment_id = $2 WHERE id = $1`, [txnId, pay.id]);
    return pay;
  } catch (e) {
    await query(`UPDATE mpesa_transactions SET status = $2, completed_at = NULL WHERE id = $1`, [txnId, t.source === 'claim' ? 'claimed' : 'unmatched']);
    throw e;
  }
}

// ---- someone paid the Paybill directly ----
export async function handleC2B(org, body) {
  const p = parseC2B(body);
  if (!p || !(p.amount > 0)) return { ignored: true };
  // Already recorded by hand, or through a payment prompt? Then do not record it twice.
  const existing = (await query(`SELECT id FROM fee_payments WHERE organization_id = $1 AND lower(reference) = lower($2) AND reversed_at IS NULL LIMIT 1`, [org, p.transId])).rows[0];
  const studentId = existing ? null : await findStudentByRef(org, p.account);
  let id;
  try {
    id = (await query(
      `INSERT INTO mpesa_transactions (organization_id, source, status, trans_id, amount, phone, account_ref, payment_id, raw, completed_at)
       VALUES ($1,'c2b',$2,$3,$4,$5,$6,$7,$8, CASE WHEN $2 = 'paid' THEN now() END) RETURNING id`,
      [org, existing ? 'paid' : 'unmatched', p.transId, p.amount, p.phone || null, p.account || null, existing?.id || null, JSON.stringify(body)])).rows[0].id;
  } catch (e) {
    if (e.code === '23505') return { duplicate: true };   // Safaricom sent it twice
    throw e;
  }
  if (studentId) await postToStudent(id, studentId);
  return { id, matched: !!studentId };
}

// ---- the customer answered (or ignored) the payment prompt ----
export async function handleStk(org, body) {
  const r = parseStkCallback(body);
  if (!r) return { ignored: true };
  const t = (await query(`SELECT * FROM mpesa_transactions WHERE organization_id = $1 AND checkout_request_id = $2`, [org, r.checkoutRequestId])).rows[0];
  if (!t || t.status !== 'pending') return { ignored: true };
  if (r.resultCode !== 0) {
    await query(`UPDATE mpesa_transactions SET status = $2, result_desc = $3, completed_at = now(), raw = $4 WHERE id = $1`,
      [t.id, r.resultCode === 1032 ? 'cancelled' : 'failed', r.resultDesc.slice(0, 200), JSON.stringify(body)]);
    return { failed: true };
  }
  const dup = r.receipt ? (await query(`SELECT id, payment_id FROM mpesa_transactions WHERE organization_id = $1 AND trans_id = $2 AND id <> $3`, [org, r.receipt, t.id])).rows[0] : null;
  if (dup) {   // the Paybill notification for this same payment already arrived and was recorded
    await query(`UPDATE mpesa_transactions SET status = 'paid', payment_id = $2, student_id = $3, result_desc = 'Recorded', completed_at = now(), raw = $4 WHERE id = $1`, [t.id, dup.payment_id, t.student_id, JSON.stringify(body)]);
    return { duplicate: true };
  }
  await query(`UPDATE mpesa_transactions SET trans_id = $2, amount = COALESCE($3, amount), phone = COALESCE($4, phone), result_desc = $5, raw = $6 WHERE id = $1`,
    [t.id, r.receipt, r.amount, r.phone, r.resultDesc.slice(0, 200), JSON.stringify(body)]);
  await postToStudent(t.id, t.student_id);
  return { paid: true };
}
