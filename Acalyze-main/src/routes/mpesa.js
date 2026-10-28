import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requirePerm, requireRole } from '../middleware/auth.js';
import { requireFeature } from '../lib/plans.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { audit } from '../lib/audit.js';
import { encryptSecret, secretsReady } from '../lib/secrets.js';
import { createDarajaClient, normalizePhone } from '../lib/daraja.js';
import { getSettings, credsFrom, hookUrls, newHookToken, postToStudent, findStudentByRef } from '../lib/mpesa.js';

// M-Pesa for a school: its own Paybill settings, payments waiting for a decision, and paying from the parent's app.
export const mpesaRouter = Router();
mpesaRouter.use(requireAuth, requireFeature('mpesa'));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const staffOnly = [requirePerm('finance.view')];
const settingsOnly = [requirePerm('finance.settings')];
const adminId = (req) => (req.auth.actingAsPlatformAdmin ? null : req.auth.sub);

const view = (row) => row && ({
  env: row.env, shortcode: row.shortcode, enabled: row.enabled, hasKey: !!row.consumer_key_enc, hasSecret: !!row.consumer_secret_enc, hasPasskey: !!row.passkey_enc,
  urls: hookUrls(row.organization_id, row.hook_token), urlsRegisteredAt: row.urls_registered_at,
});

mpesaRouter.get('/settings', ...settingsOnly, asyncHandler(async (req, res) => {
  const row = await getSettings(req.auth.organizationId);
  res.json({ secretsReady: secretsReady(), appUrlSet: !!process.env.APP_URL, settings: view(row) });
}));

mpesaRouter.put('/settings', ...settingsOnly, asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, b = req.body || {};
  if (!secretsReady()) return res.status(400).json({ error: 'The server is not set up to store keys yet. Ask Acalyze support to add the MPESA_SECRET_KEY setting.' });
  const shortcode = String(b.shortcode || '').trim();
  if (!/^\d{5,7}$/.test(shortcode)) return res.status(400).json({ error: 'Enter your Paybill number (5 to 7 digits).' });
  const env = b.env === 'production' ? 'production' : 'sandbox';
  const enc = (v) => (String(v || '').trim() ? encryptSecret(String(v).trim()) : null);   // blank means "keep what is saved"
  const cur = await getSettings(org);
  const next = { key: enc(b.consumerKey) || cur?.consumer_key_enc, secret: enc(b.consumerSecret) || cur?.consumer_secret_enc, passkey: enc(b.passkey) || cur?.passkey_enc };
  const enabled = b.enabled === true;
  if (enabled && !(next.key && next.secret && next.passkey)) return res.status(400).json({ error: 'Add the consumer key, consumer secret and passkey before switching M-Pesa on.' });
  const { rows } = await query(
    `INSERT INTO mpesa_settings (organization_id, env, shortcode, consumer_key_enc, consumer_secret_enc, passkey_enc, hook_token, enabled, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
     ON CONFLICT (organization_id) DO UPDATE SET env = EXCLUDED.env, shortcode = EXCLUDED.shortcode, consumer_key_enc = EXCLUDED.consumer_key_enc,
       consumer_secret_enc = EXCLUDED.consumer_secret_enc, passkey_enc = EXCLUDED.passkey_enc, enabled = EXCLUDED.enabled, updated_at = now()
     RETURNING *`,
    [org, env, shortcode, next.key, next.secret, next.passkey, cur?.hook_token || newHookToken(), enabled]);
  await audit(req, { area: 'finance', action: 'mpesa.settings', entity: 'settings', detail: { shortcode, env, enabled, changedKeys: !!(enc(b.consumerKey) || b.consumerSecret || b.passkey) } });   // keys are never written to the log
  res.json(view(rows[0]));
}));

const clientFor = async (org) => {
  const row = await getSettings(org);
  if (!row?.consumer_key_enc || !row.consumer_secret_enc || !row.passkey_enc) throw Object.assign(new Error('Save your keys first.'), { status: 400 });
  return { row, client: createDarajaClient(credsFrom(row)) };
};

mpesaRouter.post('/test', ...settingsOnly, asyncHandler(async (req, res) => {
  try { const { client } = await clientFor(req.auth.organizationId); await client.token(); res.json({ ok: true, message: 'Safaricom accepted your keys.' }); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
}));

mpesaRouter.post('/register-urls', ...settingsOnly, asyncHandler(async (req, res) => {
  try {
    const { row, client } = await clientFor(req.auth.organizationId), urls = hookUrls(row.organization_id, row.hook_token);
    if (!urls) return res.status(400).json({ error: 'The server needs the APP_URL setting before it can tell Safaricom where to send payments.' });
    await client.registerUrls({ confirmationUrl: urls.confirm, validationUrl: urls.validate });
    await query(`UPDATE mpesa_settings SET urls_registered_at = now() WHERE organization_id = $1`, [row.organization_id]);
    await audit(req, { area: 'finance', action: 'mpesa.register_urls', entity: 'settings' });
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
}));

// A new secret address. Do this if the old one may have leaked, then register the addresses again.
mpesaRouter.post('/rotate-token', ...settingsOnly, asyncHandler(async (req, res) => {
  const { rows } = await query(`UPDATE mpesa_settings SET hook_token = $2, urls_registered_at = NULL WHERE organization_id = $1 RETURNING *`, [req.auth.organizationId, newHookToken()]);
  if (!rows[0]) return res.status(404).json({ error: 'Save your settings first.' });
  await audit(req, { area: 'finance', action: 'mpesa.rotate', entity: 'settings' });
  res.json(view(rows[0]));
}));

// ---- payments needing a decision, and recent history ----
mpesaRouter.get('/transactions', ...staffOnly, asyncHandler(async (req, res) => {
  const attention = req.query.view !== 'recent';
  const { rows } = await query(
    `SELECT t.id, t.source, t.status, t.trans_id, t.amount::float AS amount, t.phone, t.account_ref, t.result_desc, t.note, t.created_at, t.student_id, s.full_name AS student_name, p.receipt_no
     FROM mpesa_transactions t LEFT JOIN students s ON s.id = t.student_id LEFT JOIN fee_payments p ON p.id = t.payment_id
     WHERE t.organization_id = $1 AND ${attention ? `t.status IN ('unmatched','claimed')` : 'true'}
     ORDER BY t.created_at DESC LIMIT 100`, [req.auth.organizationId]);
  res.json(rows);
}));

mpesaRouter.post('/transactions/:id/assign', ...staffOnly, asyncHandler(async (req, res) => {
  if (!['principal', 'finance'].includes(req.auth.role) && !req.auth.actingAsPlatformAdmin) return res.status(403).json({ error: 'Not allowed.' });
  const org = req.auth.organizationId, studentId = String(req.body?.studentId || '');
  if (!UUID.test(studentId)) return res.status(400).json({ error: 'Choose a student.' });
  const st = (await query(`SELECT id, full_name FROM students WHERE id = $1 AND organization_id = $2`, [studentId, org])).rows[0];
  const t = (await query(`SELECT id, source, amount::float AS amount, trans_id FROM mpesa_transactions WHERE id = $1 AND organization_id = $2`, [req.params.id, org])).rows[0];
  if (!st || !t) return res.status(404).json({ error: 'Not found.' });
  const amount = req.body?.amount != null && req.body.amount !== '' ? Number(req.body.amount) : t.amount;
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter the amount received.' });
  const pay = await postToStudent(t.id, studentId, { amount, recordedById: adminId(req) });
  if (!pay) return res.status(409).json({ error: 'This payment was already dealt with.' });
  await audit(req, { area: 'finance', action: 'mpesa.assign', entity: 'payment', entityId: pay.id, detail: { receipt: pay.receipt_no, amount, student: st.full_name, code: t.trans_id } });
  res.json(pay);
}));

mpesaRouter.post('/transactions/:id/ignore', ...staffOnly, asyncHandler(async (req, res) => {
  const reason = String(req.body?.reason || '').trim().slice(0, 200);
  if (reason.length < 3) return res.status(400).json({ error: 'Say why it is being set aside.' });
  const { rows } = await query(
    `UPDATE mpesa_transactions SET status = CASE WHEN source = 'claim' THEN 'rejected' ELSE 'ignored' END, note = $3, completed_at = now()
     WHERE id = $1 AND organization_id = $2 AND status IN ('unmatched','claimed') RETURNING id, trans_id, amount::float AS amount`, [req.params.id, req.auth.organizationId, reason]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found, or already dealt with.' });
  await audit(req, { area: 'finance', action: 'mpesa.ignore', entity: 'transaction', entityId: rows[0].id, detail: { amount: rows[0].amount, note: reason, code: rows[0].trans_id } });
  res.json({ ok: true });
}));

// ---- the parent pays from the app ----
async function parentOwns(req, studentId) {
  if (!UUID.test(String(studentId || ''))) return false;
  const { rows } = await query(`SELECT 1 FROM parent_students ps JOIN students s ON s.id = ps.student_id WHERE ps.parent_id = $1 AND ps.student_id = $2 AND s.organization_id = $3`, [req.auth.sub, studentId, req.auth.organizationId]);
  return !!rows[0];
}

mpesaRouter.post('/pay', requireRole('parent'), asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, { studentId } = req.body || {};
  if (!(await parentOwns(req, studentId))) return res.status(403).json({ error: "You can only pay for your own child." });
  const amount = Math.round(Number(req.body.amount)), phone = normalizePhone(req.body.phone);
  if (!(amount >= 1 && amount <= 250000)) return res.status(400).json({ error: 'Enter an amount from 1 to 250,000 shillings.' });
  if (!phone) return res.status(400).json({ error: 'Enter a Safaricom number like 0712 345 678.' });
  const row = await getSettings(org);
  if (!row?.enabled) return res.status(400).json({ error: 'Paying by M-Pesa is not switched on for this school.' });
  const urls = hookUrls(org, row.hook_token);
  if (!urls) return res.status(400).json({ error: 'Paying by M-Pesa is not ready yet. Please use the payment instructions.' });
  const st = (await query(`SELECT school_id_number FROM students WHERE id = $1`, [studentId])).rows[0];
  let r;
  try { r = await createDarajaClient(credsFrom(row)).stkPush({ amount, phone, accountRef: st.school_id_number, desc: 'School fees', callbackUrl: urls.stk }); }
  catch (e) { return res.status(502).json({ error: `Could not send the payment request: ${e.message}` }); }
  if (String(r.ResponseCode) !== '0') return res.status(502).json({ error: r.ResponseDescription || 'Safaricom did not accept the request.' });
  await query(
    `INSERT INTO mpesa_transactions (organization_id, source, status, checkout_request_id, amount, phone, account_ref, student_id, created_by_id) VALUES ($1,'stk','pending',$2,$3,$4,$5,$6,$7)`,
    [org, r.CheckoutRequestID, amount, phone, st.school_id_number, studentId, String(req.auth.sub)]);
  res.json({ checkoutRequestId: r.CheckoutRequestID, message: r.CustomerMessage || 'Check your phone and enter your M-Pesa PIN.' });
}));

// The app asks every few seconds. If Safaricom's message never comes, we ask Safaricom once and, if the payment went through,
// leave it for the finance officer to confirm against the M-Pesa statement (a query does not return the receipt code).
mpesaRouter.get('/pay/:checkoutId', requireRole('parent'), asyncHandler(async (req, res) => {
  const org = req.auth.organizationId;
  const t = (await query(`SELECT id, status, result_desc, amount::float AS amount, created_at FROM mpesa_transactions WHERE organization_id = $1 AND checkout_request_id = $2 AND created_by_id = $3`,
    [org, req.params.checkoutId, String(req.auth.sub)])).rows[0];
  if (!t) return res.status(404).json({ error: 'Not found.' });
  if (t.status === 'pending' && Date.now() - new Date(t.created_at).getTime() > 45_000) {
    try {
      const row = await getSettings(org), q = await createDarajaClient(credsFrom(row)).stkQuery(req.params.checkoutId);
      if (String(q.ResultCode) === '0') {
        await query(`UPDATE mpesa_transactions SET status = 'unmatched', result_desc = 'Paid, waiting for confirmation' WHERE id = $1 AND status = 'pending'`, [t.id]);
        return res.json({ status: 'confirming', message: 'Your payment went through. The school will confirm it shortly.' });
      }
      if (q.ResultCode != null && String(q.ResultCode) !== '4999') {   // 4999 means "still being processed"
        await query(`UPDATE mpesa_transactions SET status = 'failed', result_desc = $2, completed_at = now() WHERE id = $1 AND status = 'pending'`, [t.id, String(q.ResultDesc || '').slice(0, 200)]);
        return res.json({ status: 'failed', message: q.ResultDesc || 'The payment was not completed.' });
      }
    } catch { /* ask again on the next check */ }
  }
  res.json({ status: t.status, message: t.result_desc || '' });
}));

// "I already paid": the parent gives the M-Pesa code, and the finance officer checks it against the statement.
mpesaRouter.post('/claim', requireRole('parent'), asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, { studentId } = req.body || {};
  if (!(await parentOwns(req, studentId))) return res.status(403).json({ error: "You can only do this for your own child." });
  const code = String(req.body.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{8,12}$/.test(code)) return res.status(400).json({ error: 'Enter the M-Pesa code from your message (about 10 letters and numbers).' });
  const known = (await query(`SELECT p.receipt_no FROM fee_payments p WHERE p.organization_id = $1 AND lower(p.reference) = lower($2) AND p.reversed_at IS NULL LIMIT 1`, [org, code])).rows[0];
  if (known) return res.json({ alreadyRecorded: true, receipt: known.receipt_no });
  await query(
    `INSERT INTO mpesa_transactions (organization_id, source, status, trans_id, amount, student_id, note, created_by_id) VALUES ($1,'claim','claimed',$2,$3,$4,$5,$6)`,
    [org, code, Number(req.body.amount) > 0 ? Number(req.body.amount) : null, studentId, String(req.body.note || '').trim().slice(0, 200) || null, String(req.auth.sub)]);
  res.json({ claimed: true });
}));
