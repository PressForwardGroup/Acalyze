import { Router } from 'express';
import { query } from '../lib/db.js';
import { handleC2B, handleStk, tokenMatches } from '../lib/mpesa.js';

// The addresses Safaricom posts to. They are public, so each school's path carries a secret token.
// Always answer "accepted": a payment is stored first and anything odd is left for the finance officer, never lost.
export const payHooksRouter = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCEPTED = { ResultCode: 0, ResultDesc: 'Accepted' };

async function schoolFor(req) {
  if (!UUID.test(req.params.org)) return null;
  const row = (await query(`SELECT organization_id, hook_token, enabled FROM mpesa_settings WHERE organization_id = $1`, [req.params.org])).rows[0];
  return row && tokenMatches(req.params.token, row.hook_token) ? row : null;
}

const hook = (name, fn) => payHooksRouter.post(`/:org/:token/${name}`, async (req, res) => {
  const school = await schoolFor(req).catch(() => null);
  if (!school) return res.status(404).json({ error: 'Not found' });
  if (school.enabled && fn) {
    try { await fn(school.organization_id, req.body); }
    catch (e) { console.error(`M-Pesa ${name} hook failed:`, e.message); }
  }
  res.json(ACCEPTED);
});
hook('stk', handleStk);
hook('confirm', handleC2B);
hook('validate', null);   // we accept every payment, then match it to a student afterwards
