import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { decide, runCancelHook } from '../lib/approvals.js';
import { audit } from '../lib/audit.js';

// Requests waiting for the principal. The finance officer sees their own requests; the principal sees all.
export const approvalRequestsRouter = Router();
approvalRequestsRouter.use(requireAuth, requirePerm('finance.view'));

const mineOnly = (req) => (req.auth.role === 'principal' ? '' : ' AND ar.requested_by_id = $2');
const args = (req) => (req.auth.role === 'principal' ? [req.auth.organizationId] : [req.auth.organizationId, String(req.auth.sub)]);

approvalRequestsRouter.get('/count', asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT count(*)::int AS n FROM approval_requests ar WHERE ar.organization_id = $1 AND ar.status = 'pending'${mineOnly(req)}`, args(req));
  res.json({ n: rows[0].n });
}));

approvalRequestsRouter.get('/', asyncHandler(async (req, res) => {
  const pending = req.query.status !== 'decided';
  const { rows } = await query(
    `SELECT ar.id, ar.kind, ar.title, ar.amount::float AS amount, ar.payload, ar.status, ar.decision_note, ar.created_at, ar.decided_at,
            rq.full_name AS requested_by, dc.full_name AS decided_by
     FROM approval_requests ar
     LEFT JOIN admins rq ON rq.id::text = ar.requested_by_id
     LEFT JOIN admins dc ON dc.id::text = ar.decided_by_id
     WHERE ar.organization_id = $1${mineOnly(req)} AND ${pending ? `ar.status = 'pending'` : `ar.status <> 'pending'`}
     ORDER BY ar.created_at DESC LIMIT 100`, args(req));
  res.json(rows);
}));

const decideRoute = (approve) => asyncHandler(async (req, res) => {
  const note = String(req.body?.note || '').trim().slice(0, 300) || null;
  const out = await decide(req, req.params.id, approve, note);
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out.row);
});
approvalRequestsRouter.post('/:id/approve', decideRoute(true));
approvalRequestsRouter.post('/:id/reject', decideRoute(false));

approvalRequestsRouter.post('/:id/cancel', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE approval_requests SET status = 'cancelled', decided_at = now()
     WHERE id = $1 AND organization_id = $2 AND requested_by_id = $3 AND status = 'pending' RETURNING id, kind, title, payload, organization_id`,
    [req.params.id, req.auth.organizationId, String(req.auth.sub)]);
  if (!rows.length) return res.status(404).json({ error: 'No pending request of yours found.' });
  await runCancelHook(rows[0]);
  await audit(req, { area: 'finance', action: 'approval.cancel', entity: rows[0].kind, entityId: rows[0].id, detail: { title: rows[0].title } });
  res.json({ ok: true });
}));
