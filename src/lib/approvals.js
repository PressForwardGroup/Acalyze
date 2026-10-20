import { query } from './db.js';
import { audit } from './audit.js';

// Approvals: someone prepares a sensitive action, the principal approves it. The person who asked can
// never approve their own request. Actions are plugged in with registerApprovalHandler(kind, fn),
// which runs when the request is approved (for example, "void this payment").
const handlers = new Map();
export const registerApprovalHandler = (kind, fn) => handlers.set(kind, fn);

// The principal is the approver, so the principal's own actions go straight through.
export const needsApproval = (role) => role !== 'principal';

export function deciderProblem(row, auth) {
  if (!row) return 'Request not found.';
  if (auth.role !== 'principal') return 'Only the principal can approve or reject requests.';
  if (row.status !== 'pending') return `This request was already ${row.status}.`;
  if (String(row.requested_by_id) === String(auth.sub)) return 'You cannot approve your own request.';
  return null;
}

export async function requestApproval(req, { kind, title, amount = null, payload = {} }) {
  const { rows } = await query(
    `INSERT INTO approval_requests (organization_id, kind, title, amount, payload, requested_by_id, requested_by_role)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, status, created_at`,
    [req.auth.organizationId, kind, title, amount, JSON.stringify(payload), String(req.auth.sub), req.auth.role]);
  await audit(req, { area: 'finance', action: 'approval.request', entity: kind, entityId: rows[0].id, detail: { title, amount } });
  return rows[0];
}

export async function decide(req, id, approve, note = null) {
  const row = (await query(`SELECT * FROM approval_requests WHERE id = $1 AND organization_id = $2`, [id, req.auth.organizationId])).rows[0];
  const problem = deciderProblem(row, req.auth);
  if (problem) return { error: problem, status: row ? 403 : 404 };
  const handler = approve ? handlers.get(row.kind) : null;
  if (handler) await handler(row, req);
  const updated = (await query(
    `UPDATE approval_requests SET status = $1, decided_by_id = $2, decided_at = now(), decision_note = $3
     WHERE id = $4 AND status = 'pending' RETURNING *`,
    [approve ? 'approved' : 'rejected', String(req.auth.sub), note, id])).rows[0];
  if (!updated) return { error: 'This request was already decided.', status: 409 };
  await audit(req, { area: 'finance', action: approve ? 'approval.approve' : 'approval.reject', entity: row.kind, entityId: id, detail: { title: row.title, note } });
  return { row: updated };
}
