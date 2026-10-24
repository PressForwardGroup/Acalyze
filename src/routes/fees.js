import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { financeOpenToAdmin, hasPrincipal } from '../lib/financeAccess.js';
import { audit } from '../lib/audit.js';
import { CHARGE_APPLIES } from '../lib/feeSql.js';
import { chargeApplies, allocatePayments, rollupBy, overdueSummary, refundable } from '../lib/fees.js';
import { insertPayment } from '../lib/payments.js';
import { featuresForOrg } from '../lib/plans.js';
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A payment is never deleted: reversing it keeps the record, who asked and why, and stops it counting.
const reversePayment = (id, org, byId, reason) => query(
  `UPDATE fee_payments SET reversed_at = now(), reversed_by_id = $3, reversal_reason = $4 WHERE id = $1 AND organization_id = $2 AND reversed_at IS NULL`,
  [id, org, byId, reason]);
registerApprovalHandler('void_payment', async (row) => {
  await reversePayment(row.payload.paymentId, row.organization_id, UUID.test(row.requested_by_id) ? row.requested_by_id : null, row.payload.reason || 'Reversed');
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
// What each student was billed (gross), what was waived, what is owed after waivers (charged), and the money kept (payments minus refunds).
const GROSS = `COALESCE((SELECT sum(fi.amount) FROM fee_items fi WHERE fi.organization_id = s.organization_id AND fi.academic_year = $2 AND ${CHARGE_APPLIES}), 0)`;
const WAIVED = `COALESCE((SELECT sum(a.amount) FROM fee_adjustments a WHERE a.student_id = s.id AND a.academic_year = $2 AND a.status = 'approved'), 0)`;
const PAYMENTS = `COALESCE((SELECT sum(p.amount) FROM fee_payments p WHERE p.student_id = s.id AND p.academic_year = $2 AND p.reversed_at IS NULL), 0)`;
const REFUNDS = `COALESCE((SELECT sum(r.amount) FROM fee_refunds r WHERE r.student_id = s.id AND r.academic_year = $2 AND r.status = 'approved'), 0)`;
const BALANCES = `
  SELECT s.id AS student_id, s.full_name, s.school_id_number, c.name AS class_name, c.id AS class_id,
    ${GROSS}::float AS gross, LEAST(${WAIVED}, ${GROSS})::float AS waived, GREATEST(${GROSS} - ${WAIVED}, 0)::float AS charged, (${PAYMENTS} - ${REFUNDS})::float AS paid
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
  const { rows } = await query(`SELECT b.student_id FROM (${BALANCES}) b WHERE b.gross > 0 AND b.paid >= b.charged`, [req.auth.organizationId, year]);
  res.json({ year, cleared: rows.map((r) => r.student_id) });
}));

// Everything per student for the year, with waivers then payments applied to the oldest charges first.
async function loadYear(org, year) {
  const [studs, items, asg, paid, adj, refunds] = await Promise.all([
    query(`SELECT s.id, s.full_name, s.school_id_number, s.boarding, c.name AS class_name, c.id AS class_id, c.grade,
             (SELECT p.phone FROM parent_students ps JOIN parents p ON p.id = ps.parent_id WHERE ps.student_id = s.id ORDER BY p.id LIMIT 1) AS parent_phone
           FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.organization_id = $1 AND s.status = 'active'`, [org]),
    query(`SELECT id, name, vote_head, amount::float AS amount, term, to_char(due_date, 'YYYY-MM-DD') AS due_date, grade, grades, audience FROM fee_items WHERE organization_id = $1 AND academic_year = $2 AND published_at IS NOT NULL`, [org, year]),
    query(`SELECT sf.student_id, sf.fee_item_id FROM student_fee_items sf JOIN fee_items fi ON fi.id = sf.fee_item_id WHERE fi.organization_id = $1 AND fi.academic_year = $2`, [org, year]),
    query(`SELECT student_id, sum(amount)::float AS n FROM fee_payments WHERE organization_id = $1 AND academic_year = $2 AND reversed_at IS NULL GROUP BY student_id`, [org, year]),
    query(`SELECT student_id, sum(amount)::float AS n FROM fee_adjustments WHERE organization_id = $1 AND academic_year = $2 AND status = 'approved' GROUP BY student_id`, [org, year]),
    query(`SELECT student_id, sum(amount)::float AS n FROM fee_refunds WHERE organization_id = $1 AND academic_year = $2 AND status = 'approved' GROUP BY student_id`, [org, year]),
  ]);
  const taken = new Set(asg.rows.map((a) => `${a.student_id}:${a.fee_item_id}`)), by = (r) => new Map(r.rows.map((x) => [x.student_id, x.n]));
  const paidBy = by(paid), adjBy = by(adj), refBy = by(refunds);
  return studs.rows.map((s) => {
    const mine = items.rows.filter((i) => chargeApplies({ ...i, published: true }, { grade: s.grade, boarding: s.boarding, assigned: taken.has(`${s.id}:${i.id}`) }));
    return { student: s, ...allocatePayments(mine, (paidBy.get(s.id) || 0) - (refBy.get(s.id) || 0), adjBy.get(s.id) || 0) };
  });
}
const eatToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

// Fee report: charged, waived, paid and owed by vote head and by term.
feesRouter.get('/report', financeGuard(), asyncHandler(async (req, res) => {
  const year = String(req.query.year || thisYear()), per = await loadYear(req.auth.organizationId, year);
  const all = per.flatMap((p) => p.lines), credit = per.reduce((n, p) => n + p.credit, 0);
  const out = (key) => rollupBy(all, key).sort((a, b) => b.charged - a.charged);
  res.json({ year, byVoteHead: out((l) => l.vote_head || l.name), byTerm: out((l) => l.term || 'Whole year'), credit: Math.round(credit * 100) / 100 });
}));

// Who owes, how much is overdue, and for how long. Parent phone is shown so the finance officer can follow up.
feesRouter.get('/defaulters', financeGuard(), asyncHandler(async (req, res) => {
  const year = String(req.query.year || thisYear()), today = eatToday(), classId = String(req.query.classId || '');
  const ageing = { notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 }, rows = [];
  for (const p of await loadYear(req.auth.organizationId, year)) {
    if (classId && p.student.class_id !== classId) continue;
    const owed = Math.round(p.lines.reduce((n, l) => n + l.balance, 0) * 100) / 100;
    if (owed <= 0) continue;
    const o = overdueSummary(p.lines, today);
    ageing[o.bucket === 'current' ? 'notDue' : o.bucket] += o.overdue; ageing.notDue += owed - o.overdue;
    rows.push({ student_id: p.student.id, full_name: p.student.full_name, school_id_number: p.student.school_id_number, class_name: p.student.class_name, parent_phone: p.student.parent_phone, balance: owed, overdue: o.overdue, oldest_due: o.oldest, days_overdue: o.days });
  }
  rows.sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
  const r2 = (n) => Math.round(n * 100) / 100;
  res.json({ year, today, ageing: Object.fromEntries(Object.entries(ageing).map(([k, v]) => [k, r2(v)])), total: r2(rows.reduce((n, r) => n + r.balance, 0)), students: rows.length, rows: rows.slice(0, 500) });
}));

// The day's takings by method, for cashing up. Reversed payments are listed separately and not counted.
feesRouter.get('/cashup', financeGuard(), asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : eatToday();
  const [pays, refs, reversed] = await Promise.all([
    query(`SELECT p.receipt_no, p.amount::float AS amount, p.method, p.reference, s.full_name, s.school_id_number, rb.full_name AS recorded_by
           FROM fee_payments p JOIN students s ON s.id = p.student_id LEFT JOIN admins rb ON rb.id = p.recorded_by_id
           WHERE p.organization_id = $1 AND p.paid_on = $2 AND p.reversed_at IS NULL ORDER BY p.created_at`, [org, date]),
    query(`SELECT r.amount::float AS amount, r.method, r.reference, r.reason, s.full_name FROM fee_refunds r JOIN students s ON s.id = r.student_id
           WHERE r.organization_id = $1 AND r.refunded_on = $2 AND r.status = 'approved' ORDER BY r.created_at`, [org, date]),
    query(`SELECT p.receipt_no, p.amount::float AS amount, p.reversal_reason, s.full_name FROM fee_payments p JOIN students s ON s.id = p.student_id
           WHERE p.organization_id = $1 AND (p.reversed_at AT TIME ZONE 'Africa/Nairobi')::date = $2 ORDER BY p.reversed_at`, [org, date]),
  ]);
  const byMethod = {};
  for (const p of pays.rows) { const m = byMethod[p.method] ||= { method: p.method, count: 0, total: 0 }; m.count++; m.total = Math.round((m.total + p.amount) * 100) / 100; }
  const total = pays.rows.reduce((n, p) => n + p.amount, 0), refunded = refs.rows.reduce((n, r) => n + r.amount, 0);
  res.json({ date, payments: pays.rows, byMethod: Object.values(byMethod), total: Math.round(total * 100) / 100, refunds: refs.rows, refunded: Math.round(refunded * 100) / 100, net: Math.round((total - refunded) * 100) / 100, reversed: reversed.rows });
}));

// ---------- waivers, bursaries, discounts and refunds ----------
// The finance officer asks and the principal approves (if the school has a principal account). Only approved ones count.
const ADJ_KINDS = ['waiver', 'bursary', 'discount', 'sibling', 'staff_child', 'other'];
const setStatus = (table, id, org, status) => query(`UPDATE ${table} SET status = $3 WHERE id = $1 AND organization_id = $2 AND status = 'pending'`, [id, org, status]);
registerApprovalHandler('fee_adjustment', (row) => setStatus('fee_adjustments', row.payload.adjustmentId, row.organization_id, 'approved'), {
  reject: (row) => setStatus('fee_adjustments', row.payload.adjustmentId, row.organization_id, 'rejected'), cancel: (row) => setStatus('fee_adjustments', row.payload.adjustmentId, row.organization_id, 'cancelled') });
registerApprovalHandler('fee_refund', (row) => setStatus('fee_refunds', row.payload.refundId, row.organization_id, 'approved'), {
  reject: (row) => setStatus('fee_refunds', row.payload.refundId, row.organization_id, 'rejected'), cancel: (row) => setStatus('fee_refunds', row.payload.refundId, row.organization_id, 'cancelled') });

feesRouter.get('/adjustments', financeGuard(), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.kind, a.amount::float AS amount, a.reason, a.sponsor, a.status, a.created_at, s.full_name, s.school_id_number, cb.full_name AS created_by
     FROM fee_adjustments a JOIN students s ON s.id = a.student_id LEFT JOIN admins cb ON cb.id::text = a.created_by_id
     WHERE a.organization_id = $1 AND a.academic_year = $2 ORDER BY a.created_at DESC LIMIT 200`, [req.auth.organizationId, String(req.query.year || thisYear())]);
  res.json(rows);
}));

feesRouter.post('/adjustments', financeGuard(), asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, b = req.body || {}, year = String(b.academicYear || thisYear()).slice(0, 10);
  const amount = parseAmount(b.amount), reason = String(b.reason || '').trim().slice(0, 200), sponsor = String(b.sponsor || '').trim().slice(0, 80) || null;
  if (!ADJ_KINDS.includes(b.kind)) return res.status(400).json({ error: 'Choose what kind of reduction this is.' });
  if (amount == null || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount.' });
  if (reason.length < 3) return res.status(400).json({ error: 'Say why the fees are being reduced.' });
  const d = await buildStatement(org, String(b.studentId || ''), year);
  if (!d) return res.status(404).json({ error: 'Student not found' });
  const pending = (await query(`SELECT COALESCE(sum(amount), 0)::float AS n FROM fee_adjustments WHERE student_id = $1 AND academic_year = $2 AND status = 'pending'`, [d.student.id, year])).rows[0].n;
  const room = Math.max(0, d.charged - d.waived - pending);
  if (amount > room) return res.status(400).json({ error: `That is more than ${d.student.full_name} is charged. At most KSh ${room.toLocaleString('en-KE')} can still be reduced.` });
  const asks = req.auth.role === 'finance' && await hasPrincipal(org);
  const { rows } = await query(
    `INSERT INTO fee_adjustments (organization_id, student_id, academic_year, kind, amount, reason, sponsor, status, created_by_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [org, d.student.id, year, b.kind, amount, reason, sponsor, asks ? 'pending' : 'approved', adminId(req)]);
  if (asks) {
    const ask = await requestApproval(req, { kind: 'fee_adjustment', title: `Reduce ${d.student.full_name}'s fees by KSh ${amount.toLocaleString('en-KE')} (${b.kind})`, amount, payload: { adjustmentId: rows[0].id, reason } });
    return res.status(202).json({ pendingApproval: true, requestId: ask.id, message: 'Sent to the principal for approval.' });
  }
  await audit(req, { area: 'finance', action: 'adjustment.create', entity: 'adjustment', entityId: rows[0].id, detail: { student: d.student.full_name, amount, kind: b.kind, note: reason } });
  res.status(201).json({ id: rows[0].id });
}));

feesRouter.get('/refunds', financeGuard(), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT r.id, r.amount::float AS amount, r.method, r.reference, r.reason, r.status, to_char(r.refunded_on, 'YYYY-MM-DD') AS refunded_on, s.full_name, s.school_id_number, cb.full_name AS created_by
     FROM fee_refunds r JOIN students s ON s.id = r.student_id LEFT JOIN admins cb ON cb.id::text = r.created_by_id
     WHERE r.organization_id = $1 AND r.academic_year = $2 ORDER BY r.created_at DESC LIMIT 200`, [req.auth.organizationId, String(req.query.year || thisYear())]);
  res.json(rows);
}));

// A refund can only return money the student has paid beyond what they owe (a credit). To refund a student who left,
// first reduce their remaining charges with a waiver, which creates the credit.
feesRouter.post('/refunds', financeGuard(), asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, b = req.body || {}, year = String(b.academicYear || thisYear()).slice(0, 10);
  const amount = parseAmount(b.amount), reason = String(b.reason || '').trim().slice(0, 200), method = METHODS.includes(b.method) ? b.method : null;
  if (amount == null || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount.' });
  if (!method) return res.status(400).json({ error: 'Choose how the money is returned.' });
  if (reason.length < 3) return res.status(400).json({ error: 'Say why the money is being refunded.' });
  const d = await buildStatement(org, String(b.studentId || ''), year);
  if (!d) return res.status(404).json({ error: 'Student not found' });
  const pending = (await query(`SELECT COALESCE(sum(amount), 0)::float AS n FROM fee_refunds WHERE student_id = $1 AND academic_year = $2 AND status = 'pending'`, [d.student.id, year])).rows[0].n;
  const room = refundable(d.net, d.paid, pending);
  if (amount > room) return res.status(400).json({ error: room > 0 ? `Only KSh ${room.toLocaleString('en-KE')} of credit can be refunded.` : `${d.student.full_name} has no credit to refund. A refund can only return money paid beyond what is owed.` });
  const asks = req.auth.role === 'finance' && await hasPrincipal(org);
  const { rows } = await query(
    `INSERT INTO fee_refunds (organization_id, student_id, academic_year, amount, method, reference, reason, status, created_by_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [org, d.student.id, year, amount, method, String(b.reference || '').trim().slice(0, 60) || null, reason, asks ? 'pending' : 'approved', adminId(req)]);
  if (asks) {
    const ask = await requestApproval(req, { kind: 'fee_refund', title: `Refund KSh ${amount.toLocaleString('en-KE')} to ${d.student.full_name}'s parent`, amount, payload: { refundId: rows[0].id, reason } });
    return res.status(202).json({ pendingApproval: true, requestId: ask.id, message: 'Sent to the principal for approval.' });
  }
  await audit(req, { area: 'finance', action: 'refund.create', entity: 'refund', entityId: rows[0].id, detail: { student: d.student.full_name, amount, method, note: reason } });
  res.status(201).json({ id: rows[0].id });
}));

// A student's invoice / statement: what applies to them, what they paid, what is left.
async function buildStatement(org, studentId, year, { forParent = false } = {}) {
  const st = (await query(
    `SELECT s.id, s.full_name, s.school_id_number, s.boarding, c.name AS class_name, c.grade FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = $1 AND s.organization_id = $2`,
    [studentId, org])).rows[0];
  if (!st) return null;
  const [items, pays, school, adjs, refs] = await Promise.all([
    query(`SELECT fi.name, fi.vote_head, fi.amount::float AS amount, fi.term, to_char(fi.due_date, 'YYYY-MM-DD') AS due_date, fi.note
           FROM fee_items fi JOIN students s ON s.id = $2 AND s.organization_id = fi.organization_id LEFT JOIN classes c ON c.id = s.class_id
           WHERE fi.organization_id = $1 AND fi.academic_year = $3 AND ${CHARGE_APPLIES}
           ORDER BY fi.term NULLS FIRST, fi.due_date NULLS LAST, fi.name`, [org, studentId, year]),
    query(`SELECT id, receipt_no, amount::float AS amount, method, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, reversed_at, reversal_reason FROM fee_payments WHERE student_id = $1 AND academic_year = $2 ${forParent ? 'AND reversed_at IS NULL' : ''} ORDER BY paid_on DESC, created_at DESC`, [studentId, year]),
    query(`SELECT name, motto, logo_url, pay_instructions FROM organizations WHERE id = $1`, [org]),
    query(`SELECT kind, amount::float AS amount, reason, sponsor, status FROM fee_adjustments WHERE student_id = $1 AND academic_year = $2 ${forParent ? `AND status = 'approved'` : `AND status IN ('pending','approved')`} ORDER BY created_at`, [studentId, year]),
    query(`SELECT amount::float AS amount, method, reason, status, to_char(refunded_on, 'YYYY-MM-DD') AS refunded_on FROM fee_refunds WHERE student_id = $1 AND academic_year = $2 ${forParent ? `AND status = 'approved'` : `AND status IN ('pending','approved')`} ORDER BY created_at`, [studentId, year]),
  ]);
  const sum = (a) => a.reduce((n, x) => n + x.amount, 0);
  const charged = sum(items.rows), paidGross = pays.rows.filter((p) => !p.reversed_at).reduce((n, p) => n + p.amount, 0);
  const waived = Math.min(charged, sum(adjs.rows.filter((a) => a.status === 'approved'))), refunded = sum(refs.rows.filter((r) => r.status === 'approved'));
  const net = Math.max(charged - waived, 0), paid = paidGross - refunded;
  const payOnline = forParent && !!(await query(`SELECT 1 FROM mpesa_settings WHERE organization_id = $1 AND enabled`, [org])).rows[0] && (await featuresForOrg(org)).mpesa === true;
  const { lines, credit } = allocatePayments(items.rows, paid, waived);   // waivers, then payments, cover the oldest charges first
  return { year, student: st, school: school.rows[0], items: items.rows, lines, payments: pays.rows, adjustments: adjs.rows, refunds: refs.rows, charged, waived, net, paidGross, refunded, paid, balance: balance(net, paid), credit, payOnline, instructions: school.rows[0]?.pay_instructions || '' };
}

feesRouter.get('/statement/:studentId', financeGuard(), asyncHandler(async (req, res) => {
  const d = await buildStatement(req.auth.organizationId, req.params.studentId, req.query.year || thisYear());
  if (!d) return res.status(404).json({ error: 'Student not found' });
  res.json(d);
}));

feesRouter.get('/payments', financeGuard(), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.receipt_no, p.amount::float AS amount, p.method, p.reference, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on, p.academic_year, s.full_name, s.school_id_number, p.reversed_at, p.reversal_reason
     FROM fee_payments p JOIN students s ON s.id = p.student_id WHERE p.organization_id = $1 ORDER BY p.created_at DESC LIMIT 100`, [req.auth.organizationId]);
  res.json(rows);
}));

feesRouter.post('/payments', financeGuard(), asyncHandler(async (req, res) => {
  const { studentId, amount, method = 'cash', reference, paidOn, academicYear, note } = req.body;
  const org = req.auth.organizationId, amt = parseAmount(amount);
  if (amt == null) return res.status(400).json({ error: 'Enter a valid amount.' });
  if (!METHODS.includes(method)) return res.status(400).json({ error: 'Choose how it was paid.' });
  if (paidOn && !validDay(paidOn)) return res.status(400).json({ error: 'That payment date is not valid.' });
  if (paidOn && paidOn > new Date(Date.now() + 36e5 * 14).toISOString().slice(0, 10)) return res.status(400).json({ error: 'A payment cannot be dated in the future.' });
  const st = await query(`SELECT id FROM students WHERE id = $1 AND organization_id = $2`, [studentId, org]);
  if (!st.rows[0]) return res.status(404).json({ error: 'Student not found at your school' });
  // An M-Pesa code is unique to one transaction. The same code twice is almost always a double entry.
  const ref = String(reference || '').trim();
  if (ref && method === 'mpesa' && !req.body.allowDuplicate) {
    const dup = (await query(`SELECT receipt_no FROM fee_payments WHERE organization_id = $1 AND lower(reference) = lower($2) AND reversed_at IS NULL LIMIT 1`, [org, ref])).rows[0];
    if (dup) return res.status(409).json({ error: `The same reference was already recorded on receipt ${dup.receipt_no}.`, duplicate: true });
  }
  const row = await insertPayment({ org, studentId, academicYear: academicYear || thisYear(), amount: amt, method, reference, paidOn: paidOn || null, note, recordedById: adminId(req) });
  await audit(req, { area: 'finance', action: 'payment.record', entity: 'payment', entityId: row.id, detail: { receipt: row.receipt_no, amount: row.amount, method: row.method, studentId } });
  res.status(201).json(row);
}));

// Reverse a mistaken payment. The record stays, with who reversed it and why. The finance officer asks and the principal
// approves (if the school has a principal account); the principal acts directly.
feesRouter.post('/payments/:id/reverse', financeGuard(), asyncHandler(async (req, res) => {
  const reason = String(req.body?.reason || '').trim().slice(0, 200);
  if (reason.length < 3) return res.status(400).json({ error: 'Say why the payment is being reversed.' });
  const org = req.auth.organizationId;
  const p = (await query(
    `SELECT p.id, p.receipt_no, p.amount::float AS amount, p.reversed_at, s.full_name FROM fee_payments p JOIN students s ON s.id = p.student_id WHERE p.id = $1 AND p.organization_id = $2`,
    [req.params.id, org])).rows[0];
  if (!p) return res.status(404).json({ error: 'Payment not found' });
  if (p.reversed_at) return res.status(409).json({ error: 'This payment was already reversed.' });
  if (req.auth.role === 'finance' && needsApproval(req.auth.role) && await hasPrincipal(org)) {
    const ask = await requestApproval(req, { kind: 'void_payment', title: `Reverse receipt ${p.receipt_no} (${p.full_name})`, amount: p.amount, payload: { paymentId: p.id, receiptNo: p.receipt_no, reason } });
    return res.status(202).json({ pendingApproval: true, requestId: ask.id, message: 'Sent to the principal for approval.' });
  }
  await reversePayment(p.id, org, adminId(req), reason);
  await audit(req, { area: 'finance', action: 'payment.reverse', entity: 'payment', entityId: p.id, detail: { receipt: p.receipt_no, amount: p.amount, student: p.full_name, note: reason } });
  res.json({ reversed: true });
}));

// Everything needed to print a receipt. Admin: any at their school. Parent: only their own child's.
feesRouter.get('/receipt/:id', financeGuard('parent'), asyncHandler(async (req, res) => {
  const org = req.auth.organizationId;
  const p = (await query(
    `SELECT p.id, p.receipt_no, p.amount::float AS amount, p.method, p.reference, p.note, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on, p.academic_year, p.created_at, p.student_id, p.reversed_at, p.reversal_reason,
            s.full_name, s.school_id_number, c.name AS class_name, c.grade, rb.full_name AS received_by
     FROM fee_payments p JOIN students s ON s.id = p.student_id LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN admins rb ON rb.id = p.recorded_by_id
     WHERE p.id = $1 AND p.organization_id = $2`, [req.params.id, org])).rows[0];
  if (!p) return res.status(404).json({ error: 'Receipt not found' });
  if (req.auth.role === 'parent' && !(await parentOwns(req, p.student_id))) return res.status(403).json({ error: "You can only view your own child's receipts" });
  const [charged, paidSoFar, school, waivedQ] = await Promise.all([
    query(`SELECT COALESCE(sum(fi.amount), 0)::float AS n FROM fee_items fi JOIN students s ON s.id = $3 AND s.organization_id = fi.organization_id LEFT JOIN classes c ON c.id = s.class_id
           WHERE fi.organization_id = $1 AND fi.academic_year = $2 AND ${CHARGE_APPLIES}`, [org, p.academic_year, p.student_id]),
    query(`SELECT COALESCE(sum(amount), 0)::float AS n FROM fee_payments WHERE student_id = $1 AND academic_year = $2 AND created_at <= $3 AND reversed_at IS NULL`, [p.student_id, p.academic_year, p.created_at]),
    query(`SELECT name, motto, logo_url FROM organizations WHERE id = $1`, [org]),
    query(`SELECT COALESCE(sum(amount), 0)::float AS n FROM fee_adjustments WHERE student_id = $1 AND academic_year = $2 AND status = 'approved'`, [p.student_id, p.academic_year]),
  ]);
  const owed = Math.max(charged.rows[0].n - waivedQ.rows[0].n, 0);
  res.json({ school: school.rows[0], payment: p, charged: owed, paidToDate: paidSoFar.rows[0].n, balanceAfter: balance(owed, paidSoFar.rows[0].n) });
}));

// ---------- a parent's view of their own child's fees ----------
feesRouter.get('/mine', requireRole('parent'), asyncHandler(async (req, res) => {
  const { studentId } = req.query, year = req.query.year || thisYear(), org = req.auth.organizationId;
  if (!(await parentOwns(req, studentId))) return res.status(403).json({ error: "You can only view your own child's fees" });
  const d = await buildStatement(org, studentId, year, { forParent: true });
  if (!d) return res.status(404).json({ error: 'Student not found' });
  res.json(d);
}));
