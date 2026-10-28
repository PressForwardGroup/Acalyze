import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';
import { requireFeature } from '../lib/plans.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { audit } from '../lib/audit.js';
import { METHODS, parseAmount } from '../lib/fees.js';
import { buildCashbook, isOverBudget, budgetAvailable, autoMatch, lineKey } from '../lib/books.js';
import { requestApproval, registerApprovalHandler } from '../lib/approvals.js';
import { hasPrincipal } from '../lib/financeAccess.js';

// The school's own accounts: money accounts, a budget by vote head, payment vouchers, other income,
// a cashbook per account and bank statement matching. For the principal and the finance officer only.
export const booksRouter = Router();
booksRouter.use(requireAuth, requireFeature('accounts'));
const read = requirePerm('finance.view'), write = requirePerm('finance.edit');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const eatToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const thisYear = () => String(new Date().getFullYear());
const adminId = (req) => (req.auth.actingAsPlatformAdmin ? null : req.auth.sub);
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const day = (v, d = null) => (DAY.test(String(v || '')) ? String(v) : d);
const KINDS_IN = ['grant', 'donation', 'hire', 'sales', 'interest', 'other'];
const DEFAULT_RECEIVES = { cash: ['cash'], bank: ['bank', 'cheque', 'other'], mpesa: ['mpesa'] };

// ---------- vote heads ----------
const DEFAULT_HEADS = ['Tuition and learning materials', 'Operations', 'Repairs and maintenance', 'Administration and staff', 'Co-curricular activities', 'Insurance', 'Utilities', 'Feeding', 'Transport', 'Other'];
async function ensureHeads(org) {
  if ((await query(`SELECT 1 FROM expense_heads WHERE organization_id = $1 LIMIT 1`, [org])).rows.length) return;
  for (const n of DEFAULT_HEADS) await query(`INSERT INTO expense_heads (organization_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [org, n]);
}
booksRouter.get('/heads', read, asyncHandler(async (req, res) => {
  await ensureHeads(req.auth.organizationId);
  res.json((await query(`SELECT id, name, active FROM expense_heads WHERE organization_id = $1 ORDER BY name`, [req.auth.organizationId])).rows);
}));
booksRouter.post('/heads', write, asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Give the vote head a name.' });
  try {
    const { rows } = await query(`INSERT INTO expense_heads (organization_id, name) VALUES ($1,$2) RETURNING id, name, active`, [req.auth.organizationId, name]);
    await audit(req, { area: 'finance', action: 'books.head', entity: 'head', entityId: rows[0].id, detail: { name } });
    res.status(201).json(rows[0]);
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'That vote head already exists.' }); throw e; }
}));
booksRouter.patch('/heads/:id', write, asyncHandler(async (req, res) => {
  const b = req.body || {}, name = 'name' in b ? String(b.name || '').trim().slice(0, 60) : null;
  if ('name' in b && !name) return res.status(400).json({ error: 'Give the vote head a name.' });
  try {
    const { rows } = await query(`UPDATE expense_heads SET name = COALESCE($3, name), active = COALESCE($4, active) WHERE id = $1 AND organization_id = $2 RETURNING id, name, active`,
      [req.params.id, req.auth.organizationId, name, 'active' in b ? b.active === true : null]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
    await audit(req, { area: 'finance', action: 'books.head', entity: 'head', entityId: rows[0].id, detail: { name: rows[0].name, active: rows[0].active } });
    res.json(rows[0]);
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'That vote head already exists.' }); throw e; }
}));

// ---------- money accounts and the cashbook ----------
const ACC = `id, name, kind, opening_balance::float AS opening_balance, to_char(opening_date, 'YYYY-MM-DD') AS opening_date, receives, active`;

// Every movement of money in or out of one account, up to a date. Reversed receipts stay in the book with a matching entry going out.
async function entriesFor(org, acc, to) {
  const rec = acc.receives || [], out = [];
  const [pays, refs, inc, exps, tin, tout] = await Promise.all([
    query(`SELECT p.id, to_char(p.paid_on, 'YYYY-MM-DD') AS date, p.created_at, p.receipt_no, p.reference, p.amount::float AS amount, p.reversed_at,
                  to_char((p.reversed_at AT TIME ZONE 'Africa/Nairobi')::date, 'YYYY-MM-DD') AS reversed_date, s.full_name
           FROM fee_payments p JOIN students s ON s.id = p.student_id WHERE p.organization_id = $1 AND p.method = ANY($2) AND p.paid_on <= $3`, [org, rec, to]),
    query(`SELECT r.id, to_char(r.refunded_on, 'YYYY-MM-DD') AS date, r.created_at, r.reference, r.amount::float AS amount, s.full_name
           FROM fee_refunds r JOIN students s ON s.id = r.student_id WHERE r.organization_id = $1 AND r.status = 'approved' AND r.method = ANY($2) AND r.refunded_on <= $3`, [org, rec, to]),
    query(`SELECT id, to_char(received_on, 'YYYY-MM-DD') AS date, created_at, source, reference, amount::float AS amount, reversed_at,
                  to_char((reversed_at AT TIME ZONE 'Africa/Nairobi')::date, 'YYYY-MM-DD') AS reversed_date
           FROM income_entries WHERE organization_id = $1 AND account_id = $2 AND received_on <= $3`, [org, acc.id, to]),
    query(`SELECT id, to_char(paid_on, 'YYYY-MM-DD') AS date, created_at, voucher_no, payee, reference, amount::float AS amount
           FROM expenses WHERE organization_id = $1 AND account_id = $2 AND status = 'paid' AND paid_on <= $3`, [org, acc.id, to]),
    query(`SELECT t.id, to_char(t.transfer_date, 'YYYY-MM-DD') AS date, t.created_at, t.amount::float AS amount, a.name AS other FROM account_transfers t JOIN cash_accounts a ON a.id = t.from_account_id
           WHERE t.organization_id = $1 AND t.to_account_id = $2 AND t.transfer_date <= $3`, [org, acc.id, to]),
    query(`SELECT t.id, to_char(t.transfer_date, 'YYYY-MM-DD') AS date, t.created_at, t.amount::float AS amount, a.name AS other FROM account_transfers t JOIN cash_accounts a ON a.id = t.to_account_id
           WHERE t.organization_id = $1 AND t.from_account_id = $2 AND t.transfer_date <= $3`, [org, acc.id, to]),
  ]);
  for (const p of pays.rows) {
    const voided = !!p.reversed_at, code = p.reference || p.receipt_no;
    out.push({ ref: `payment:${p.id}`, date: p.date, at: p.created_at, text: `Fees: ${p.full_name} (${p.receipt_no})`, code, in: p.amount, out: 0, voided });
    if (voided && p.reversed_date <= to) out.push({ ref: `reversal:${p.id}`, date: p.reversed_date, at: p.reversed_at, text: `Reversed receipt ${p.receipt_no}`, code, in: 0, out: p.amount, voided });
  }
  for (const r of refs.rows) out.push({ ref: `refund:${r.id}`, date: r.date, at: r.created_at, text: `Refund to parent of ${r.full_name}`, code: r.reference, in: 0, out: r.amount });
  for (const i of inc.rows) {
    const voided = !!i.reversed_at;
    out.push({ ref: `income:${i.id}`, date: i.date, at: i.created_at, text: `Income: ${i.source}`, code: i.reference, in: i.amount, out: 0, voided });
    if (voided && i.reversed_date <= to) out.push({ ref: `income_reversal:${i.id}`, date: i.reversed_date, at: i.reversed_at, text: `Reversed income: ${i.source}`, code: i.reference, in: 0, out: i.amount, voided });
  }
  for (const e of exps.rows) out.push({ ref: `expense:${e.id}`, date: e.date, at: e.created_at, text: `${e.voucher_no}: ${e.payee}`, code: e.reference, in: 0, out: e.amount });
  for (const t of tin.rows) out.push({ ref: `transfer_in:${t.id}`, date: t.date, at: t.created_at, text: `Transfer from ${t.other}`, code: null, in: t.amount, out: 0 });
  for (const t of tout.rows) out.push({ ref: `transfer_out:${t.id}`, date: t.date, at: t.created_at, text: `Transfer to ${t.other}`, code: null, in: 0, out: t.amount });
  return out;
}

async function accountOr404(org, id, res) {
  if (!UUID.test(String(id || ''))) { res.status(400).json({ error: 'Choose an account.' }); return null; }
  const acc = (await query(`SELECT ${ACC} FROM cash_accounts WHERE id = $1 AND organization_id = $2`, [id, org])).rows[0];
  if (!acc) res.status(404).json({ error: 'Account not found.' });
  return acc || null;
}
const balanceOf = async (org, acc) => buildCashbook({ openingBalance: acc.opening_balance, openingDate: acc.opening_date, entries: await entriesFor(org, acc, eatToday()) }).closing;

booksRouter.get('/accounts', read, asyncHandler(async (req, res) => {
  const accs = (await query(`SELECT ${ACC} FROM cash_accounts WHERE organization_id = $1 ORDER BY active DESC, name`, [req.auth.organizationId])).rows;
  res.json(await Promise.all(accs.map(async (a) => ({ ...a, balance: await balanceOf(req.auth.organizationId, a) }))));
}));

async function accountFields(req, res, current = null) {
  const b = req.body || {}, org = req.auth.organizationId;
  const name = 'name' in b ? String(b.name || '').trim().slice(0, 60) : current?.name;
  const kind = 'kind' in b ? b.kind : current?.kind;
  if (!name) { res.status(400).json({ error: 'Give the account a name, e.g. "Equity bank account".' }); return null; }
  if (!['cash', 'bank', 'mpesa'].includes(kind)) { res.status(400).json({ error: 'Choose cash, bank or M-Pesa.' }); return null; }
  const opening = 'openingBalance' in b ? (parseAmount(b.openingBalance === '' ? 0 : b.openingBalance) ?? NaN) : current?.opening_balance ?? 0;
  if (Number.isNaN(opening)) { res.status(400).json({ error: 'Enter a valid opening balance.' }); return null; }
  const receives = Array.isArray(b.receives) ? [...new Set(b.receives.filter((m) => METHODS.includes(m)))] : current?.receives ?? DEFAULT_RECEIVES[kind];
  const active = 'active' in b ? b.active === true : current?.active ?? true;
  // A payment method goes to one account only, otherwise the same receipt would appear in two cashbooks.
  const others = (await query(`SELECT name, receives FROM cash_accounts WHERE organization_id = $1 AND active AND id <> $2`, [org, current?.id || '00000000-0000-0000-0000-000000000000'])).rows;
  if (active) for (const o of others) { const clash = receives.find((m) => o.receives.includes(m)); if (clash) { res.status(400).json({ error: `"${clash}" payments already go to "${o.name}". A payment method can belong to one account only.` }); return null; } }
  return { name, kind, opening, openingDate: day(b.openingDate, current?.opening_date || eatToday()), receives, active };
}
booksRouter.post('/accounts', write, asyncHandler(async (req, res) => {
  const f = await accountFields(req, res); if (!f) return;
  const { rows } = await query(`INSERT INTO cash_accounts (organization_id, name, kind, opening_balance, opening_date, receives, active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.auth.organizationId, f.name, f.kind, f.opening, f.openingDate, f.receives, f.active]);
  await audit(req, { area: 'finance', action: 'books.account', entity: 'account', entityId: rows[0].id, detail: { name: f.name, kind: f.kind } });
  res.status(201).json(rows[0]);
}));
booksRouter.patch('/accounts/:id', write, asyncHandler(async (req, res) => {
  const cur = await accountOr404(req.auth.organizationId, req.params.id, res); if (!cur) return;
  const f = await accountFields(req, res, cur); if (!f) return;
  await query(`UPDATE cash_accounts SET name = $3, kind = $4, opening_balance = $5, opening_date = $6, receives = $7, active = $8 WHERE id = $1 AND organization_id = $2`,
    [cur.id, req.auth.organizationId, f.name, f.kind, f.opening, f.openingDate, f.receives, f.active]);
  await audit(req, { area: 'finance', action: 'books.account', entity: 'account', entityId: cur.id, detail: { name: f.name, active: f.active } });
  res.json({ ok: true });
}));

booksRouter.get('/cashbook', read, asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, acc = await accountOr404(org, req.query.accountId, res); if (!acc) return;
  const to = day(req.query.to, eatToday()), from = day(req.query.from, acc.opening_date);
  const entries = await entriesFor(org, acc, to);
  res.json({ account: acc, from, to, ...buildCashbook({ openingBalance: acc.opening_balance, openingDate: acc.opening_date, entries, from, to }) });
}));

// ---------- budget ----------
booksRouter.get('/budget', read, asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, year = String(req.query.year || thisYear());
  await ensureHeads(org);
  const { rows } = await query(
    `SELECT h.id, h.name, h.active, b.amount::float AS budget,
            COALESCE((SELECT sum(e.amount) FROM expenses e WHERE e.head_id = h.id AND e.academic_year = $2 AND e.status IN ('pending','approved')), 0)::float AS committed,
            COALESCE((SELECT sum(e.amount) FROM expenses e WHERE e.head_id = h.id AND e.academic_year = $2 AND e.status = 'paid'), 0)::float AS spent
     FROM expense_heads h LEFT JOIN budget_lines b ON b.head_id = h.id AND b.academic_year = $2 WHERE h.organization_id = $1 ORDER BY h.name`, [org, year]);
  res.json({ year, heads: rows.map((h) => ({ ...h, available: budgetAvailable(h.budget, h.committed, h.spent) })) });
}));
booksRouter.put('/budget', write, asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, year = String(req.body?.year || thisYear()).slice(0, 10), lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  let total = 0;
  for (const l of lines) {
    if (!UUID.test(String(l.headId || ''))) continue;
    const blank = l.amount === null || l.amount === '' || l.amount === undefined;
    const amt = blank ? null : parseAmount(l.amount);
    if (!blank && (amt == null || amt < 0)) return res.status(400).json({ error: 'A budget amount is not valid.' });
    if (blank) await query(`DELETE FROM budget_lines WHERE organization_id = $1 AND academic_year = $2 AND head_id = $3`, [org, year, l.headId]);
    else {
      const ok = await query(`INSERT INTO budget_lines (organization_id, academic_year, head_id, amount) SELECT $1, $2, h.id, $4 FROM expense_heads h WHERE h.id = $3 AND h.organization_id = $1
                              ON CONFLICT (organization_id, academic_year, head_id) DO UPDATE SET amount = EXCLUDED.amount`, [org, year, l.headId, amt]);
      if (ok.rowCount) total += amt;
    }
  }
  await audit(req, { area: 'finance', action: 'books.budget', entity: 'budget', detail: { year, total } });
  res.json({ ok: true });
}));

// ---------- payment vouchers ----------
const VOUCHER = `e.id, e.voucher_no, e.payee, e.description, e.amount::float AS amount, to_char(e.expense_date, 'YYYY-MM-DD') AS expense_date, e.academic_year, e.invoice_ref, e.status,
  e.over_budget, e.method, e.reference, to_char(e.paid_on, 'YYYY-MM-DD') AS paid_on, e.created_at, h.name AS head, a.name AS account, rq.full_name AS requested_by, pd.full_name AS paid_by`;
const VOUCHER_FROM = `FROM expenses e JOIN expense_heads h ON h.id = e.head_id LEFT JOIN cash_accounts a ON a.id = e.account_id LEFT JOIN admins rq ON rq.id::text = e.requested_by_id LEFT JOIN admins pd ON pd.id::text = e.paid_by_id`;
const setStatus = (id, org, status) => query(`UPDATE expenses SET status = $3 WHERE id = $1 AND organization_id = $2 AND status = 'pending'`, [id, org, status]);
registerApprovalHandler('expense', (row) => setStatus(row.payload.expenseId, row.organization_id, 'approved'), {
  reject: (row) => setStatus(row.payload.expenseId, row.organization_id, 'rejected'), cancel: (row) => setStatus(row.payload.expenseId, row.organization_id, 'cancelled') });

booksRouter.get('/vouchers', read, asyncHandler(async (req, res) => {
  const status = ['pending', 'approved', 'paid', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const { rows } = await query(`SELECT ${VOUCHER} ${VOUCHER_FROM} WHERE e.organization_id = $1 AND e.academic_year = $2 AND ($3::text IS NULL OR e.status = $3) ORDER BY e.created_at DESC LIMIT 300`,
    [req.auth.organizationId, String(req.query.year || thisYear()), status]);
  res.json(rows);
}));

booksRouter.get('/vouchers/:id', read, asyncHandler(async (req, res) => {
  const org = req.auth.organizationId;
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Not found.' });
  const v = (await query(`SELECT ${VOUCHER} ${VOUCHER_FROM} WHERE e.id = $1 AND e.organization_id = $2`, [req.params.id, org])).rows[0];
  if (!v) return res.status(404).json({ error: 'Not found.' });
  const [school, ap] = await Promise.all([
    query(`SELECT name, motto, logo_url FROM organizations WHERE id = $1`, [org]),
    query(`SELECT d.full_name AS approved_by, ar.status FROM approval_requests ar LEFT JOIN admins d ON d.id::text = ar.decided_by_id WHERE ar.organization_id = $1 AND ar.kind = 'expense' AND ar.payload->>'expenseId' = $2 ORDER BY ar.created_at DESC LIMIT 1`, [org, req.params.id]),
  ]);
  res.json({ school: school.rows[0], voucher: v, approvedBy: ap.rows[0]?.status === 'approved' ? ap.rows[0].approved_by : (ap.rows[0] ? null : v.requested_by) });
}));

booksRouter.post('/vouchers', write, asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, b = req.body || {}, year = String(b.year || thisYear()).slice(0, 10);
  const amount = parseAmount(b.amount), payee = String(b.payee || '').trim().slice(0, 100), description = String(b.description || '').trim().slice(0, 200);
  if (!UUID.test(String(b.headId || ''))) return res.status(400).json({ error: 'Choose a vote head.' });
  if (!payee) return res.status(400).json({ error: 'Who is being paid?' });
  if (description.length < 3) return res.status(400).json({ error: 'Say what the payment is for.' });
  if (amount == null || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount.' });
  const head = (await query(
    `SELECT h.id, h.name, b.amount::float AS budget,
            COALESCE((SELECT sum(e.amount) FROM expenses e WHERE e.head_id = h.id AND e.academic_year = $3 AND e.status IN ('pending','approved')), 0)::float AS committed,
            COALESCE((SELECT sum(e.amount) FROM expenses e WHERE e.head_id = h.id AND e.academic_year = $3 AND e.status = 'paid'), 0)::float AS spent
     FROM expense_heads h LEFT JOIN budget_lines b ON b.head_id = h.id AND b.academic_year = $3 WHERE h.id = $1 AND h.organization_id = $2 AND h.active`, [b.headId, org, year])).rows[0];
  if (!head) return res.status(404).json({ error: 'That vote head was not found.' });
  const over = isOverBudget(head.budget, head.committed, head.spent, amount);
  const threshold = Number((await query(`SELECT expense_approval_threshold::float AS t FROM organizations WHERE id = $1`, [org])).rows[0].t);
  const asks = req.auth.role === 'finance' && amount > threshold && await hasPrincipal(org);
  const { rows } = await query(
    `INSERT INTO expenses (organization_id, voucher_no, head_id, payee, description, amount, expense_date, academic_year, invoice_ref, status, over_budget, requested_by_id)
     VALUES ($1, (SELECT org_code FROM organizations WHERE id = $1) || '-PV-' || lpad(nextval('voucher_seq')::text, 6, '0'), $2,$3,$4,$5, COALESCE($6::date, current_date), $7,$8,$9,$10,$11) RETURNING id, voucher_no, status`,
    [org, head.id, payee, description, amount, day(b.expenseDate), year, String(b.invoiceRef || '').trim().slice(0, 60) || null, asks ? 'pending' : 'approved', over, adminId(req)]);
  const v = rows[0];
  if (asks) {
    const ask = await requestApproval(req, { kind: 'expense', title: `${over ? '[Over budget] ' : ''}Pay KSh ${amount.toLocaleString('en-KE')} to ${payee} (${head.name})`, amount, payload: { expenseId: v.id, voucherNo: v.voucher_no, overBudget: over } });
    return res.status(202).json({ pendingApproval: true, requestId: ask.id, voucherNo: v.voucher_no, overBudget: over, message: `Voucher ${v.voucher_no} sent to the principal for approval.` });
  }
  await audit(req, { area: 'finance', action: 'voucher.create', entity: 'voucher', entityId: v.id, detail: { voucher: v.voucher_no, payee, amount, head: head.name, overBudget: over } });
  res.status(201).json({ id: v.id, voucherNo: v.voucher_no, overBudget: over });
}));

booksRouter.post('/vouchers/:id/pay', write, asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, b = req.body || {};
  const acc = await accountOr404(org, b.accountId, res); if (!acc) return;
  if (!acc.active) return res.status(400).json({ error: 'That account is switched off.' });
  if (!METHODS.includes(b.method)) return res.status(400).json({ error: 'Choose how it was paid.' });
  const { rows } = await query(
    `UPDATE expenses SET status = 'paid', account_id = $3, method = $4, reference = $5, paid_on = COALESCE($6::date, current_date), paid_by_id = $7
     WHERE id = $1 AND organization_id = $2 AND status = 'approved' RETURNING id, voucher_no, payee, amount::float AS amount`,
    [req.params.id, org, acc.id, b.method, String(b.reference || '').trim().slice(0, 60) || null, day(b.paidOn), adminId(req)]);
  if (!rows[0]) return res.status(409).json({ error: 'Only an approved voucher can be paid.' });
  await audit(req, { area: 'finance', action: 'voucher.pay', entity: 'voucher', entityId: rows[0].id, detail: { voucher: rows[0].voucher_no, payee: rows[0].payee, amount: rows[0].amount, account: acc.name } });
  res.json(rows[0]);
}));

booksRouter.post('/vouchers/:id/cancel', write, asyncHandler(async (req, res) => {
  const org = req.auth.organizationId;
  const { rows } = await query(`UPDATE expenses SET status = 'cancelled' WHERE id = $1 AND organization_id = $2 AND status IN ('pending','approved') RETURNING id, voucher_no`, [req.params.id, org]);
  if (!rows[0]) return res.status(409).json({ error: 'Only a voucher that has not been paid can be cancelled.' });
  await query(`UPDATE approval_requests SET status = 'cancelled', decided_at = now() WHERE organization_id = $1 AND kind = 'expense' AND status = 'pending' AND payload->>'expenseId' = $2`, [org, rows[0].id]);
  await audit(req, { area: 'finance', action: 'voucher.cancel', entity: 'voucher', entityId: rows[0].id, detail: { voucher: rows[0].voucher_no } });
  res.json({ ok: true });
}));

// ---------- other income and transfers ----------
booksRouter.get('/income', read, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT i.id, i.kind, i.source, i.amount::float AS amount, to_char(i.received_on, 'YYYY-MM-DD') AS received_on, i.reference, i.note, i.reversed_at, i.reversal_reason, a.name AS account
     FROM income_entries i JOIN cash_accounts a ON a.id = i.account_id WHERE i.organization_id = $1 AND to_char(i.received_on, 'YYYY') = $2 ORDER BY i.received_on DESC, i.created_at DESC LIMIT 300`,
    [req.auth.organizationId, String(req.query.year || thisYear())]);
  res.json(rows);
}));
booksRouter.post('/income', write, asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, b = req.body || {}, amount = parseAmount(b.amount), source = String(b.source || '').trim().slice(0, 100);
  const acc = await accountOr404(org, b.accountId, res); if (!acc) return;
  if (!KINDS_IN.includes(b.kind)) return res.status(400).json({ error: 'Choose what kind of income this is.' });
  if (!source) return res.status(400).json({ error: 'Say where the money came from.' });
  if (amount == null || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount.' });
  const { rows } = await query(`INSERT INTO income_entries (organization_id, account_id, kind, source, amount, received_on, reference, note, created_by_id) VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, current_date),$7,$8,$9) RETURNING id`,
    [org, acc.id, b.kind, source, amount, day(b.receivedOn), String(b.reference || '').trim().slice(0, 60) || null, String(b.note || '').trim().slice(0, 200) || null, adminId(req)]);
  await audit(req, { area: 'finance', action: 'income.add', entity: 'income', entityId: rows[0].id, detail: { source, amount, kind: b.kind } });
  res.status(201).json(rows[0]);
}));
booksRouter.post('/income/:id/reverse', write, asyncHandler(async (req, res) => {
  const reason = String(req.body?.reason || '').trim().slice(0, 200);
  if (reason.length < 3) return res.status(400).json({ error: 'Say why it is being reversed.' });
  const { rows } = await query(`UPDATE income_entries SET reversed_at = now(), reversal_reason = $3 WHERE id = $1 AND organization_id = $2 AND reversed_at IS NULL RETURNING id, source, amount::float AS amount`, [req.params.id, req.auth.organizationId, reason]);
  if (!rows[0]) return res.status(409).json({ error: 'Not found, or already reversed.' });
  await audit(req, { area: 'finance', action: 'income.reverse', entity: 'income', entityId: rows[0].id, detail: { source: rows[0].source, amount: rows[0].amount, note: reason } });
  res.json({ reversed: true });
}));
booksRouter.post('/transfers', write, asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, b = req.body || {}, amount = parseAmount(b.amount);
  const from = await accountOr404(org, b.fromId, res); if (!from) return;
  const to = await accountOr404(org, b.toId, res); if (!to) return;
  if (from.id === to.id) return res.status(400).json({ error: 'Choose two different accounts.' });
  if (amount == null || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount.' });
  const { rows } = await query(`INSERT INTO account_transfers (organization_id, from_account_id, to_account_id, amount, transfer_date, note, created_by_id) VALUES ($1,$2,$3,$4,COALESCE($5::date, current_date),$6,$7) RETURNING id`,
    [org, from.id, to.id, amount, day(b.date), String(b.note || '').trim().slice(0, 200) || null, adminId(req)]);
  await audit(req, { area: 'finance', action: 'transfer.create', entity: 'transfer', entityId: rows[0].id, detail: { amount, from: from.name, to: to.name } });
  res.status(201).json(rows[0]);
}));

// ---------- overview ----------
booksRouter.get('/summary', read, asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, year = String(req.query.year || thisYear());
  const [accs, fees, refunds, other, spent, bud] = await Promise.all([
    query(`SELECT ${ACC} FROM cash_accounts WHERE organization_id = $1 AND active ORDER BY name`, [org]),
    query(`SELECT COALESCE(sum(amount), 0)::float AS n FROM fee_payments WHERE organization_id = $1 AND academic_year = $2 AND reversed_at IS NULL`, [org, year]),
    query(`SELECT COALESCE(sum(amount), 0)::float AS n FROM fee_refunds WHERE organization_id = $1 AND academic_year = $2 AND status = 'approved'`, [org, year]),
    query(`SELECT kind, sum(amount)::float AS total FROM income_entries WHERE organization_id = $1 AND to_char(received_on, 'YYYY') = $2 AND reversed_at IS NULL GROUP BY kind ORDER BY kind`, [org, year]),
    query(`SELECT COALESCE(sum(amount) FILTER (WHERE status = 'paid'), 0)::float AS spent, COALESCE(sum(amount) FILTER (WHERE status IN ('pending','approved')), 0)::float AS committed FROM expenses WHERE organization_id = $1 AND academic_year = $2`, [org, year]),
    query(`SELECT COALESCE(sum(amount), 0)::float AS n FROM budget_lines WHERE organization_id = $1 AND academic_year = $2`, [org, year]),
  ]);
  const feesNet = r2(fees.rows[0].n - refunds.rows[0].n), otherTotal = r2(other.rows.reduce((n, o) => n + o.total, 0));
  res.json({
    year, accounts: await Promise.all(accs.rows.map(async (a) => ({ id: a.id, name: a.name, kind: a.kind, balance: await balanceOf(org, a) }))),
    income: { fees: feesNet, other: other.rows, otherTotal, total: r2(feesNet + otherTotal) }, spent: spent.rows[0].spent, committed: spent.rows[0].committed, budget: bud.rows[0].n, net: r2(feesNet + otherTotal - spent.rows[0].spent),
  });
}));

// ---------- settings ----------
booksRouter.get('/settings', read, asyncHandler(async (req, res) => {
  res.json({ approvalThreshold: (await query(`SELECT expense_approval_threshold::float AS t FROM organizations WHERE id = $1`, [req.auth.organizationId])).rows[0].t });
}));
booksRouter.put('/settings', requirePerm('finance.approve'), asyncHandler(async (req, res) => {   // only the principal sets how much the finance officer may pay without approval
  const t = parseAmount(req.body?.approvalThreshold === '' ? 0 : req.body?.approvalThreshold);
  if (t == null || t < 0) return res.status(400).json({ error: 'Enter a valid amount, or 0 to approve every voucher.' });
  await query(`UPDATE organizations SET expense_approval_threshold = $2 WHERE id = $1`, [req.auth.organizationId, t]);
  await audit(req, { area: 'finance', action: 'books.settings', entity: 'settings', detail: { approvalThreshold: t } });
  res.json({ approvalThreshold: t });
}));

// ---------- bank statement matching ----------
async function unreconciled(org, acc) {
  const entries = await entriesFor(org, acc, eatToday());
  const taken = new Set((await query(`SELECT matched_ref FROM bank_statement_lines WHERE account_id = $1 AND status = 'matched' AND matched_ref IS NOT NULL`, [acc.id])).rows.map((r) => r.matched_ref));
  return entries.filter((e) => e.date >= acc.opening_date && !e.voided && !taken.has(e.ref)).map((e) => ({ ref: e.ref, date: e.date, amount: r2(e.in - e.out), text: e.text, code: e.code }));
}
async function runAutoMatch(org, acc) {
  const lines = (await query(`SELECT id, to_char(line_date, 'YYYY-MM-DD') AS date, amount::float AS amount, concat_ws(' ', description, reference) AS text FROM bank_statement_lines WHERE account_id = $1 AND status = 'unmatched' ORDER BY line_date, created_at`, [acc.id])).rows;
  const hits = autoMatch(lines, await unreconciled(org, acc));
  for (const h of hits) await query(`UPDATE bank_statement_lines SET status = 'matched', matched_ref = $2 WHERE id = $1 AND status = 'unmatched'`, [h.lineId, h.ref]);
  return hits.length;
}

booksRouter.get('/statement', read, asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, acc = await accountOr404(org, req.query.accountId, res); if (!acc) return;
  const [lines, book] = await Promise.all([
    query(`SELECT id, to_char(line_date, 'YYYY-MM-DD') AS date, description, reference, amount::float AS amount, status, matched_ref FROM bank_statement_lines WHERE account_id = $1 ORDER BY line_date DESC, created_at DESC LIMIT 500`, [acc.id]),
    unreconciled(org, acc),
  ]);
  const un = lines.rows.filter((l) => l.status === 'unmatched');
  res.json({ account: acc, lines: lines.rows, unreconciled: book, summary: { lines: lines.rows.length, unmatched: un.length, unmatchedTotal: r2(un.reduce((n, l) => n + l.amount, 0)), unreconciledEntries: book.length, unreconciledTotal: r2(book.reduce((n, e) => n + e.amount, 0)) } });
}));

booksRouter.post('/statement/import', write, asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, acc = await accountOr404(org, req.body?.accountId, res); if (!acc) return;
  const lines = (Array.isArray(req.body?.lines) ? req.body.lines : []).slice(0, 5000)
    .map((l) => ({ date: day(l.date), description: String(l.description || '').slice(0, 200), reference: String(l.reference || '').slice(0, 80), amount: Number(l.amount) })).filter((l) => l.date && Number.isFinite(l.amount) && l.amount !== 0);
  if (!lines.length) return res.status(400).json({ error: 'No transactions were found in that file.' });
  let added = 0;
  for (const l of lines) added += (await query(`INSERT INTO bank_statement_lines (organization_id, account_id, line_date, description, reference, amount, line_key) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (account_id, line_key) DO NOTHING`,
    [org, acc.id, l.date, l.description, l.reference || null, l.amount, lineKey(l)])).rowCount;
  const matched = await runAutoMatch(org, acc);
  await audit(req, { area: 'finance', action: 'statement.import', entity: 'account', entityId: acc.id, detail: { name: acc.name, added, matched } });
  res.json({ added, skipped: lines.length - added, matched });
}));

async function lineOr404(org, id, res) {
  const l = UUID.test(String(id)) ? (await query(`SELECT id, account_id, amount::float AS amount, status FROM bank_statement_lines WHERE id = $1 AND organization_id = $2`, [id, org])).rows[0] : null;
  if (!l) res.status(404).json({ error: 'Not found.' });
  return l || null;
}
booksRouter.post('/statement/:id/match', write, asyncHandler(async (req, res) => {
  const org = req.auth.organizationId, l = await lineOr404(org, req.params.id, res); if (!l) return;
  const acc = await accountOr404(org, l.account_id, res); if (!acc) return;
  const entry = (await unreconciled(org, acc)).find((e) => e.ref === req.body?.ref);
  if (!entry) return res.status(404).json({ error: 'That entry is not available to match.' });
  if (Math.abs(entry.amount - l.amount) > 0.005) return res.status(400).json({ error: 'The amounts are different. Only lines with the same amount can be matched.' });
  await query(`UPDATE bank_statement_lines SET status = 'matched', matched_ref = $2 WHERE id = $1`, [l.id, entry.ref]);
  res.json({ ok: true });
}));
const setLine = (status) => asyncHandler(async (req, res) => {
  const l = await lineOr404(req.auth.organizationId, req.params.id, res); if (!l) return;
  await query(`UPDATE bank_statement_lines SET status = $2, matched_ref = NULL WHERE id = $1`, [l.id, status]);
  res.json({ ok: true });
});
booksRouter.post('/statement/:id/unmatch', write, setLine('unmatched'));
booksRouter.post('/statement/:id/ignore', write, setLine('ignored'));
