import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { financeOpenToAdmin, hasPrincipal } from '../lib/financeAccess.js';
import { audit } from '../lib/audit.js';
import { needsApproval, requestApproval, registerApprovalHandler } from '../lib/approvals.js';
import { requireFeature } from '../lib/plans.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { METHODS, parseAmount, balance, summarizeBalances } from '../lib/fees.js';
import { validDay } from '../lib/attendance.js';

export const feesRouter = Router();
feesRouter.use(requireAuth, requireFeature('fees'));

// Money belongs to the principal and the finance officer. A school admin keeps access only until the school has
// created one of those accounts, so nobody is locked out during the switch. Parents get the screens made for them.
const financeGuard = (...extra) => async (req, res, next) => {
  const r = req.auth.role;
  if (r === 'principal' || r === 'finance' || extra.includes(r)) return next();
  if (r === 'admin' && await financeOpenToAdmin(req.auth.organizationId)) return next();
  return res.status(403).json({ error: 'Fees and payments are handled by the finance officer and the principal.' });
};

// When the finance officer voids a payment, the principal approves it first (if the school has a principal account).
registerApprovalHandler('void_payment', async (row, req) => {
  await query(`DELETE FROM fee_payments WHERE id = $1 AND organization_id = $2`, [row.payload.paymentId, row.organization_id]);
});

const thisYear = () => String(new Date().getFullYear());
const adminId = (req) => (req.auth.actingAsPlatformAdmin ? null : req.auth.sub);

// Charges that apply to a student in a year, and what they have paid.
const BALANCES = `
  SELECT s.id AS student_id, s.full_name, s.school_id_number, c.name AS class_name, c.id AS class_id,
    COALESCE((SELECT sum(fi.amount) FROM fee_items fi WHERE fi.organization_id = s.organization_id AND fi.academic_year = $2
              AND (fi.grade IS NULL OR fi.grade = c.grade)), 0)::float AS charged,
    COALESCE((SELECT sum(p.amount) FROM fee_payments p WHERE p.student_id = s.id AND p.academic_year = $2), 0)::float AS paid
  FROM students s LEFT JOIN classes c ON c.id = s.class_id
  WHERE s.organization_id = $1 AND s.status = 'active'`;

async function parentOwns(req, studentId) {
  const { rows } = await query(
    `SELECT 1 FROM parent_students ps JOIN students s ON s.id = ps.student_id WHERE ps.parent_id = $1 AND ps.student_id = $2 AND s.organization_id = $3`,
    [req.auth.sub, studentId, req.auth.organizationId]);
  return !!rows[0];
}

// ---------- charges (what the school bills) ----------
feesRouter.get('/items', financeGuard(), asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT id, name, amount::float AS amount, academic_year, term, grade FROM fee_items WHERE organization_id = $1 AND academic_year = $2 ORDER BY term NULLS FIRST, name`, [req.auth.organizationId, req.query.year || thisYear()]);
  const years = await query(`SELECT DISTINCT academic_year FROM (SELECT academic_year FROM fee_items WHERE organization_id = $1 UNION SELECT academic_year FROM fee_payments WHERE organization_id = $1) y ORDER BY 1 DESC`, [req.auth.organizationId]);
  res.json({ items: rows, years: years.rows.map((y) => y.academic_year) });
}));

feesRouter.post('/items', financeGuard(), asyncHandler(async (req, res) => {
  const { name, amount, academicYear, term, grade } = req.body;
  const amt = parseAmount(amount);
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Give the charge a name, e.g. "Tuition".' });
  if (amt == null) return res.status(400).json({ error: 'Enter a valid amount.' });
  const { rows } = await query(
    `INSERT INTO fee_items (organization_id, name, amount, academic_year, term, grade) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, amount::float AS amount, academic_year, term, grade`,
    [req.auth.organizationId, String(name).trim().slice(0, 80), amt, String(academicYear || thisYear()).slice(0, 10), term || null, String(grade || '').trim() || null]);
  await audit(req, { area: 'finance', action: 'fee_item.create', entity: 'fee_item', entityId: rows[0].id, detail: { name: rows[0].name, amount: rows[0].amount, year: rows[0].academic_year, grade: rows[0].grade } });
  res.status(201).json(rows[0]);
}));

feesRouter.delete('/items/:id', financeGuard(), asyncHandler(async (req, res) => {
  const r = await query(`DELETE FROM fee_items WHERE id = $1 AND organization_id = $2`, [req.params.id, req.auth.organizationId]);
  if (!r.rowCount) return res.status(404).json({ error: 'Charge not found' });
  await audit(req, { area: 'finance', action: 'fee_item.delete', entity: 'fee_item', entityId: req.params.id });
  res.status(204).end();
}));

// ---------- balances ----------
feesRouter.get('/balances', financeGuard(), asyncHandler(async (req, res) => {
  const year = req.query.year || thisYear();
  const { rows } = await query(`${BALANCES} ${req.query.classId ? 'AND s.class_id = $3' : ''} ORDER BY c.name, s.full_name`, req.query.classId ? [req.auth.organizationId, year, req.query.classId] : [req.auth.organizationId, year]);
  const list = rows.map((r) => ({ ...r, balance: balance(r.charged, r.paid) }));
  res.json({ year, summary: summarizeBalances(rows), rows: list });
}));

// ---------- payments & receipts ----------
feesRouter.get('/payments', financeGuard(), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.receipt_no, p.amount::float AS amount, p.method, p.reference, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on, p.academic_year, s.full_name, s.school_id_number
     FROM fee_payments p JOIN students s ON s.id = p.student_id WHERE p.organization_id = $1 ORDER BY p.created_at DESC LIMIT 100`, [req.auth.organizationId]);
  res.json(rows);
}));

feesRouter.post('/payments', financeGuard(), asyncHandler(async (req, res) => {
  const { studentId, amount, method = 'cash', reference, paidOn, academicYear, note } = req.body;
  const org = req.auth.organizationId, amt = parseAmount(amount);
  if (amt == null) return res.status(400).json({ error: 'Enter a valid amount.' });
  if (!METHODS.includes(method)) return res.status(400).json({ error: 'Choose how it was paid.' });
  if (paidOn && !validDay(paidOn)) return res.status(400).json({ error: 'That payment date is not valid.' });
  const st = await query(`SELECT id FROM students WHERE id = $1 AND organization_id = $2`, [studentId, org]);
  if (!st.rows[0]) return res.status(404).json({ error: 'Student not found at your school' });
  const code = (await query(`SELECT org_code FROM organizations WHERE id = $1`, [org])).rows[0].org_code;
  const { rows } = await query(
    `INSERT INTO fee_payments (organization_id, student_id, academic_year, amount, method, reference, paid_on, receipt_no, note, recorded_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, current_date), $8::text || '-' || lpad(nextval('fee_receipt_seq')::text, 6, '0'), $9, $10)
     RETURNING id, receipt_no, amount::float AS amount, method, reference, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, academic_year`,
    [org, studentId, String(academicYear || thisYear()).slice(0, 10), amt, method, String(reference || '').trim().slice(0, 60) || null, paidOn || null, code, String(note || '').trim().slice(0, 200) || null, adminId(req)]);
  await audit(req, { area: 'finance', action: 'payment.record', entity: 'payment', entityId: rows[0].id, detail: { receipt: rows[0].receipt_no, amount: rows[0].amount, method: rows[0].method, studentId } });
  res.status(201).json(rows[0]);
}));

// Void a mistaken payment. (Money records: this is deliberate and confirmed in the UI.)
feesRouter.delete('/payments/:id', financeGuard(), asyncHandler(async (req, res) => {
  const p = (await query(
    `SELECT p.id, p.receipt_no, p.amount::float AS amount, s.full_name FROM fee_payments p JOIN students s ON s.id = p.student_id WHERE p.id = $1 AND p.organization_id = $2`,
    [req.params.id, req.auth.organizationId])).rows[0];
  if (!p) return res.status(404).json({ error: 'Payment not found' });
  // The finance officer asks; the principal approves. The principal (or a school with no principal yet) acts directly.
  if (req.auth.role === 'finance' && needsApproval(req.auth.role) && await hasPrincipal(req.auth.organizationId)) {
    const ask = await requestApproval(req, { kind: 'void_payment', title: `Void receipt ${p.receipt_no} (${p.full_name})`, amount: p.amount, payload: { paymentId: p.id, receiptNo: p.receipt_no } });
    return res.status(202).json({ pendingApproval: true, requestId: ask.id, message: 'Sent to the principal for approval.' });
  }
  await query(`DELETE FROM fee_payments WHERE id = $1 AND organization_id = $2`, [req.params.id, req.auth.organizationId]);
  await audit(req, { area: 'finance', action: 'payment.void', entity: 'payment', entityId: p.id, detail: { receipt: p.receipt_no, amount: p.amount, student: p.full_name } });
  res.status(204).end();
}));

// Everything needed to print a receipt. Admin: any at their school. Parent: only their own child's.
feesRouter.get('/receipt/:id', financeGuard('parent'), asyncHandler(async (req, res) => {
  const org = req.auth.organizationId;
  const p = (await query(
    `SELECT p.id, p.receipt_no, p.amount::float AS amount, p.method, p.reference, p.note, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on, p.academic_year, p.created_at, p.student_id,
            s.full_name, s.school_id_number, c.name AS class_name, c.grade
     FROM fee_payments p JOIN students s ON s.id = p.student_id LEFT JOIN classes c ON c.id = s.class_id
     WHERE p.id = $1 AND p.organization_id = $2`, [req.params.id, org])).rows[0];
  if (!p) return res.status(404).json({ error: 'Receipt not found' });
  if (req.auth.role === 'parent' && !(await parentOwns(req, p.student_id))) return res.status(403).json({ error: "You can only view your own child's receipts" });
  const [charged, paidSoFar, school] = await Promise.all([
    query(`SELECT COALESCE(sum(amount), 0)::float AS n FROM fee_items WHERE organization_id = $1 AND academic_year = $2 AND (grade IS NULL OR grade = $3)`, [org, p.academic_year, p.grade]),
    query(`SELECT COALESCE(sum(amount), 0)::float AS n FROM fee_payments WHERE student_id = $1 AND academic_year = $2 AND created_at <= $3`, [p.student_id, p.academic_year, p.created_at]),
    query(`SELECT name, motto, logo_url FROM organizations WHERE id = $1`, [org]),
  ]);
  res.json({ school: school.rows[0], payment: p, charged: charged.rows[0].n, paidToDate: paidSoFar.rows[0].n, balanceAfter: balance(charged.rows[0].n, paidSoFar.rows[0].n) });
}));

// ---------- a parent's view of their own child's fees ----------
feesRouter.get('/mine', requireRole('parent'), asyncHandler(async (req, res) => {
  const { studentId } = req.query, year = req.query.year || thisYear(), org = req.auth.organizationId;
  if (!(await parentOwns(req, studentId))) return res.status(403).json({ error: "You can only view your own child's fees" });
  const st = (await query(`SELECT c.grade FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = $1`, [studentId])).rows[0];
  const [items, pays] = await Promise.all([
    query(`SELECT name, amount::float AS amount, term FROM fee_items WHERE organization_id = $1 AND academic_year = $2 AND (grade IS NULL OR grade = $3) ORDER BY term NULLS FIRST, name`, [org, year, st?.grade || null]),
    query(`SELECT id, receipt_no, amount::float AS amount, method, to_char(paid_on, 'YYYY-MM-DD') AS paid_on FROM fee_payments WHERE student_id = $1 AND academic_year = $2 ORDER BY paid_on DESC, created_at DESC`, [studentId, year]),
  ]);
  const charged = items.rows.reduce((n, i) => n + i.amount, 0), paid = pays.rows.reduce((n, p) => n + p.amount, 0);
  res.json({ year, items: items.rows, payments: pays.rows, charged, paid, balance: balance(charged, paid) });
}));
