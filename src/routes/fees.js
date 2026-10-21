import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { financeOpenToAdmin, hasPrincipal } from '../lib/financeAccess.js';
import { audit } from '../lib/audit.js';
import { CHARGE_APPLIES } from '../lib/feeSql.js';
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

registerApprovalHandler('publish_fee_items', async (row) => {
  await query(`UPDATE fee_items SET published_at = now() WHERE organization_id = $1 AND id = ANY($2) AND published_at IS NULL`, [row.organization_id, row.payload.itemIds]);
});
registerApprovalHandler('delete_fee_item', async (row) => {
  await query(`DELETE FROM fee_items WHERE id = $1 AND organization_id = $2`, [row.payload.itemId, row.organization_id]);
});

const thisYear = () => String(new Date().getFullYear());
const adminId = (req) => (req.auth.actingAsPlatformAdmin ? null : req.auth.sub);

// Charges that apply to a student in a year, and what they have paid.
const BALANCES = `
  SELECT s.id AS student_id, s.full_name, s.school_id_number, c.name AS class_name, c.id AS class_id,
    COALESCE((SELECT sum(fi.amount) FROM fee_items fi WHERE fi.organization_id = s.organization_id AND fi.academic_year = $2
              AND ${CHARGE_APPLIES}), 0)::float AS charged,
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
// A new charge is a draft: it is not billed and parents cannot see it. Publishing makes it count. (If the finance
// officer publishes, the principal approves first.) Only drafts can be edited; a published charge can be deleted and re-added.
const TERMS = ['Term 1', 'Term 2', 'Term 3'];
const AUDIENCES = ['all', 'day', 'boarding', 'optional'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_COLS = `fi.id, fi.name, fi.vote_head, fi.amount::float AS amount, fi.academic_year, fi.term, fi.grade, fi.grades, fi.audience,
  to_char(fi.due_date, 'YYYY-MM-DD') AS due_date, fi.note, fi.published_at,
  (SELECT count(*)::int FROM student_fee_items sf WHERE sf.fee_item_id = fi.id) AS assigned`;

function itemFields(b = {}) {
  const grades = Array.isArray(b.grades) ? [...new Set(b.grades.map((g) => String(g).trim()).filter(Boolean))].slice(0, 40) : [];
  return {
    name: String(b.name || '').trim().slice(0, 80), amt: parseAmount(b.amount),
    voteHead: String(b.voteHead || '').trim().slice(0, 40) || null, term: TERMS.includes(b.term) ? b.term : null,
    audience: AUDIENCES.includes(b.audience) ? b.audience : 'all', grades: grades.length ? grades : null,
    due: /^\d{4}-\d{2}-\d{2}$/.test(String(b.dueDate || '')) ? b.dueDate : null, note: String(b.note || '').trim().slice(0, 300) || null,
  };
}

feesRouter.get('/items', financeGuard(), asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, year = req.query.year || thisYear();
  const [items, years, school] = await Promise.all([
    query(`SELECT ${ITEM_COLS} FROM fee_items fi WHERE fi.organization_id = $1 AND fi.academic_year = $2 ORDER BY fi.term NULLS FIRST, fi.vote_head NULLS LAST, fi.name`, [org, year]),
    query(`SELECT DISTINCT academic_year FROM (SELECT academic_year FROM fee_items WHERE organization_id = $1 UNION SELECT academic_year FROM fee_payments WHERE organization_id = $1) y ORDER BY academic_year DESC`, [org]),
    query(`SELECT pay_instructions FROM organizations WHERE id = $1`, [org]),
  ]);
  res.json({ items: items.rows, years: years.rows.map((y) => y.academic_year), instructions: school.rows[0]?.pay_instructions || '' });
}));

feesRouter.post('/items', financeGuard(), asyncHandler(async (req, res) => {
  const f = itemFields(req.body);
  if (!f.name) return res.status(400).json({ error: 'Give the charge a name, e.g. "Tuition".' });
  if (f.amt == null) return res.status(400).json({ error: 'Enter a valid amount.' });
  const { rows } = await query(
    `INSERT INTO fee_items (organization_id, name, vote_head, amount, academic_year, term, grades, audience, due_date, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [req.auth.organizationId, f.name, f.voteHead, f.amt, String(req.body.academicYear || thisYear()).slice(0, 10), f.term, f.grades, f.audience, f.due, f.note]);
  await audit(req, { area: 'finance', action: 'fee_item.create', entity: 'fee_item', entityId: rows[0].id, detail: { name: f.name, amount: f.amt, year: req.body.academicYear || thisYear() } });
  res.status(201).json(rows[0]);
}));

feesRouter.post('/items/publish', financeGuard(), asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, year = String(req.body?.year || thisYear());
  const drafts = (await query(`SELECT id FROM fee_items WHERE organization_id = $1 AND academic_year = $2 AND published_at IS NULL`, [org, year])).rows;
  if (!drafts.length) return res.status(400).json({ error: 'There are no draft charges to publish.' });
  const ids = drafts.map((d) => d.id);
  if (req.auth.role === 'finance' && await hasPrincipal(org)) {
    const ask = await requestApproval(req, { kind: 'publish_fee_items', title: `Publish ${ids.length} fee charge${ids.length === 1 ? '' : 's'} for ${year}`, payload: { itemIds: ids, year } });
    return res.status(202).json({ pendingApproval: true, requestId: ask.id, message: 'Sent to the principal for approval. Parents see the charges once it is approved.' });
  }
  await query(`UPDATE fee_items SET published_at = now() WHERE organization_id = $1 AND id = ANY($2) AND published_at IS NULL`, [org, ids]);
  await audit(req, { area: 'finance', action: 'fee_item.publish', entity: 'fee_item', detail: { count: ids.length, year } });
  res.json({ published: ids.length });
}));

feesRouter.patch('/items/:id', financeGuard(), asyncHandler(async (req, res) => {
  const f = itemFields(req.body);
  if (!f.name) return res.status(400).json({ error: 'Give the charge a name.' });
  if (f.amt == null) return res.status(400).json({ error: 'Enter a valid amount.' });
  const { rows } = await query(
    `UPDATE fee_items SET name = $1, vote_head = $2, amount = $3, term = $4, grades = $5, audience = $6, due_date = $7, note = $8
     WHERE id = $9 AND organization_id = $10 AND published_at IS NULL RETURNING id`,
    [f.name, f.voteHead, f.amt, f.term, f.grades, f.audience, f.due, f.note, req.params.id, req.auth.organizationId]);
  if (!rows.length) return res.status(409).json({ error: 'Only a draft charge can be edited. Delete a published one and add it again.' });
  await audit(req, { area: 'finance', action: 'fee_item.update', entity: 'fee_item', entityId: rows[0].id, detail: { name: f.name, amount: f.amt } });
  res.json(rows[0]);
}));

feesRouter.delete('/items/:id', financeGuard(), asyncHandler(async (req, res) => {
  const org = req.auth.organizationId;
  const it = (await query(`SELECT id, name, amount::float AS amount, published_at FROM fee_items WHERE id = $1 AND organization_id = $2`, [req.params.id, org])).rows[0];
  if (!it) return res.status(404).json({ error: 'Charge not found' });
  if (it.published_at && req.auth.role === 'finance' && await hasPrincipal(org)) {
    const ask = await requestApproval(req, { kind: 'delete_fee_item', title: `Delete published charge "${it.name}"`, amount: it.amount, payload: { itemId: it.id } });
    return res.status(202).json({ pendingApproval: true, requestId: ask.id, message: 'Sent to the principal for approval.' });
  }
  await query(`DELETE FROM fee_items WHERE id = $1 AND organization_id = $2`, [it.id, org]);
  await audit(req, { area: 'finance', action: 'fee_item.delete', entity: 'fee_item', entityId: it.id, detail: { name: it.name, amount: it.amount } });
  res.status(204).end();
}));

// Optional charges (a transport route, lunch, a trip) are billed only to the students assigned to them.
feesRouter.get('/items/:id/assignments', financeGuard(), asyncHandler(async (req, res) => {
  if (!UUID.test(String(req.query.classId || ''))) return res.status(400).json({ error: 'Choose a class.' });
  const { rows } = await query(
    `SELECT s.id, s.full_name, s.school_id_number,
            EXISTS (SELECT 1 FROM student_fee_items sf WHERE sf.fee_item_id = $1 AND sf.student_id = s.id) AS assigned
     FROM students s WHERE s.organization_id = $2 AND s.class_id = $3 AND s.status = 'active' ORDER BY s.full_name`,
    [req.params.id, req.auth.organizationId, req.query.classId]);
  res.json(rows);
}));

feesRouter.put('/items/:id/assignments', financeGuard(), asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, classId = String(req.body?.classId || '');
  const ids = (Array.isArray(req.body?.studentIds) ? req.body.studentIds : []).map(String).filter((x) => UUID.test(x));
  if (!UUID.test(classId)) return res.status(400).json({ error: 'Choose a class.' });
  const it = (await query(`SELECT id, name FROM fee_items WHERE id = $1 AND organization_id = $2 AND audience = 'optional'`, [req.params.id, org])).rows[0];
  if (!it) return res.status(404).json({ error: 'Only an optional charge is assigned to students.' });
  await query(`DELETE FROM student_fee_items sf USING students s WHERE sf.student_id = s.id AND sf.fee_item_id = $1 AND s.class_id = $2 AND s.organization_id = $3`, [it.id, classId, org]);
  if (ids.length) await query(`INSERT INTO student_fee_items (student_id, fee_item_id) SELECT s.id, $1 FROM students s WHERE s.organization_id = $3 AND s.class_id = $2 AND s.id = ANY($4) ON CONFLICT DO NOTHING`, [it.id, classId, org, ids]);
  await audit(req, { area: 'finance', action: 'fee_item.assign', entity: 'fee_item', entityId: it.id, detail: { name: it.name, students: ids.length } });
  res.json({ assigned: ids.length });
}));

// Day scholar or boarder: some charges apply to one kind only.
feesRouter.get('/boarding', financeGuard(), asyncHandler(async (req, res) => {
  if (!UUID.test(String(req.query.classId || ''))) return res.status(400).json({ error: 'Choose a class.' });
  const { rows } = await query(`SELECT id, full_name, school_id_number, boarding FROM students WHERE organization_id = $1 AND class_id = $2 AND status = 'active' ORDER BY full_name`, [req.auth.organizationId, req.query.classId]);
  res.json(rows);
}));

feesRouter.put('/boarding', financeGuard(), asyncHandler(async (req, res) => {
  const classId = String(req.body?.classId || '');
  const ids = (Array.isArray(req.body?.boardingIds) ? req.body.boardingIds : []).map(String).filter((x) => UUID.test(x));
  if (!UUID.test(classId)) return res.status(400).json({ error: 'Choose a class.' });
  await query(`UPDATE students SET boarding = CASE WHEN id = ANY($3) THEN 'boarding' ELSE 'day' END WHERE organization_id = $1 AND class_id = $2 AND status = 'active'`, [req.auth.organizationId, classId, ids]);
  await audit(req, { area: 'finance', action: 'fees.boarding', entity: 'class', entityId: classId, detail: { boarders: ids.length } });
  res.json({ boarders: ids.length });
}));

// How parents pay (shown on their fees page).
feesRouter.patch('/instructions', financeGuard(), asyncHandler(async (req, res) => {
  const text = String(req.body?.text ?? '').trim().slice(0, 600);
  await query(`UPDATE organizations SET pay_instructions = $1 WHERE id = $2`, [text || null, req.auth.organizationId]);
  await audit(req, { area: 'finance', action: 'fees.instructions', entity: 'settings' });
  res.json({ instructions: text });
}));

// ---------- balances ----------
feesRouter.get('/balances', financeGuard(), asyncHandler(async (req, res) => {
  const year = req.query.year || thisYear();
  const { rows } = await query(`${BALANCES} ${req.query.classId ? 'AND s.class_id = $3' : ''} ORDER BY c.name, s.full_name`, req.query.classId ? [req.auth.organizationId, year, req.query.classId] : [req.auth.organizationId, year]);
  const list = rows.map((r) => ({ ...r, balance: balance(r.charged, r.paid) }));
  res.json({ year, summary: summarizeBalances(rows), rows: list });
}));

// ---------- payments & receipts ----------
// Students who have paid everything charged for the year. Only IDs: school admins and teachers see a "cleared" tag, never amounts.
feesRouter.get('/cleared', requireRole('admin', 'teacher', 'principal', 'finance'), asyncHandler(async (req, res) => {
  const year = req.query.year || thisYear();
  const { rows } = await query(`SELECT b.student_id FROM (${BALANCES}) b WHERE b.charged > 0 AND b.paid >= b.charged`, [req.auth.organizationId, year]);
  res.json({ year, cleared: rows.map((r) => r.student_id) });
}));

// A student's invoice / statement: what applies to them, what they paid, what is left.
async function buildStatement(org, studentId, year) {
  const st = (await query(
    `SELECT s.id, s.full_name, s.school_id_number, s.boarding, c.name AS class_name, c.grade FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = $1 AND s.organization_id = $2`,
    [studentId, org])).rows[0];
  if (!st) return null;
  const [items, pays, school] = await Promise.all([
    query(`SELECT fi.name, fi.vote_head, fi.amount::float AS amount, fi.term, to_char(fi.due_date, 'YYYY-MM-DD') AS due_date, fi.note
           FROM fee_items fi JOIN students s ON s.id = $2 AND s.organization_id = fi.organization_id LEFT JOIN classes c ON c.id = s.class_id
           WHERE fi.organization_id = $1 AND fi.academic_year = $3 AND ${CHARGE_APPLIES}
           ORDER BY fi.term NULLS FIRST, fi.due_date NULLS LAST, fi.name`, [org, studentId, year]),
    query(`SELECT id, receipt_no, amount::float AS amount, method, to_char(paid_on, 'YYYY-MM-DD') AS paid_on FROM fee_payments WHERE student_id = $1 AND academic_year = $2 ORDER BY paid_on DESC, created_at DESC`, [studentId, year]),
    query(`SELECT name, motto, logo_url, pay_instructions FROM organizations WHERE id = $1`, [org]),
  ]);
  const charged = items.rows.reduce((n, i) => n + i.amount, 0), paid = pays.rows.reduce((n, p) => n + p.amount, 0);
  return { year, student: st, school: school.rows[0], items: items.rows, payments: pays.rows, charged, paid, balance: balance(charged, paid), instructions: school.rows[0]?.pay_instructions || '' };
}

feesRouter.get('/statement/:studentId', financeGuard(), asyncHandler(async (req, res) => {
  const d = await buildStatement(req.auth.organizationId, req.params.studentId, req.query.year || thisYear());
  if (!d) return res.status(404).json({ error: 'Student not found' });
  res.json(d);
}));

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
    query(`SELECT COALESCE(sum(fi.amount), 0)::float AS n FROM fee_items fi JOIN students s ON s.id = $3 AND s.organization_id = fi.organization_id LEFT JOIN classes c ON c.id = s.class_id
           WHERE fi.organization_id = $1 AND fi.academic_year = $2 AND ${CHARGE_APPLIES}`, [org, p.academic_year, p.student_id]),
    query(`SELECT COALESCE(sum(amount), 0)::float AS n FROM fee_payments WHERE student_id = $1 AND academic_year = $2 AND created_at <= $3`, [p.student_id, p.academic_year, p.created_at]),
    query(`SELECT name, motto, logo_url FROM organizations WHERE id = $1`, [org]),
  ]);
  res.json({ school: school.rows[0], payment: p, charged: charged.rows[0].n, paidToDate: paidSoFar.rows[0].n, balanceAfter: balance(charged.rows[0].n, paidSoFar.rows[0].n) });
}));

// ---------- a parent's view of their own child's fees ----------
feesRouter.get('/mine', requireRole('parent'), asyncHandler(async (req, res) => {
  const { studentId } = req.query, year = req.query.year || thisYear(), org = req.auth.organizationId;
  if (!(await parentOwns(req, studentId))) return res.status(403).json({ error: "You can only view your own child's fees" });
  const d = await buildStatement(org, studentId, year);
  if (!d) return res.status(404).json({ error: 'Student not found' });
  res.json(d);
}));
