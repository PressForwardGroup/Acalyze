import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js';
import { hashPassword } from '../lib/auth.js';
import { tempPassword } from '../lib/parents.js';
import { forgetOrgStatus } from '../lib/orgStatus.js';
import { sendEmail, appUrl } from '../lib/mail.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { audit } from '../lib/audit.js';
import { passwordProblem } from '../lib/password.js';
import { MODULES, normalizeModules } from '../lib/modules.js';
import { featuresForOrgRow } from '../lib/plans.js';
import { SECTION_KEYS, SECTION_LABELS } from '../lib/curriculum.js';
import { normalizeSections, parseSections } from '../lib/sections.js';

export const organizationsRouter = Router();
organizationsRouter.use(requireAuth, requirePlatformAdmin);

function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function codify(name) {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  return (letters.slice(0, 3) || 'SCH');
}

// ---------- Registration queue ----------
organizationsRouter.get('/registrations', asyncHandler(async (req, res) => {
  const status = req.query.status || 'pending';
  const { rows } = await query(
    `SELECT * FROM school_registrations WHERE status = $1 ORDER BY submitted_at DESC`, [status]);
  res.json(rows);
}));

organizationsRouter.post('/registrations/:id/reject', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE school_registrations SET status = 'rejected', reviewed_by_id = $1, reviewed_at = now()
     WHERE id = $2 AND status = 'pending' RETURNING *`,
    [req.auth.sub, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Registration not found or already reviewed' });
  res.json(rows[0]);
}));

// Approve = provision: create the organization, its first center, and the
// school admin login, in one step — the "we review, then provision their
// workspace" flow from the registration mockup, made real.
organizationsRouter.post('/registrations/:id/approve', asyncHandler(async (req, res) => {
  const reg = await query(`SELECT * FROM school_registrations WHERE id = $1 AND status = 'pending'`, [req.params.id]);
  if (!reg.rows[0]) return res.status(404).json({ error: 'Registration not found or already reviewed' });
  const r = reg.rows[0];

  // The school admin's login is chosen by you when you approve (pre-filled with the school's own email).
  // Checked before anything is created, so a bad or taken email leaves nothing half-made.
  const adminEmail = String(req.body?.adminEmail ?? r.contact_email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) return res.status(400).json({ error: 'Enter the email this school will sign in with, for example office@school.org.' });
  const taken = await query(
    `SELECT 1 FROM admins WHERE lower(email) = $1
     UNION SELECT 1 FROM teachers WHERE lower(email) = $1
     UNION SELECT 1 FROM platform_admins WHERE lower(email) = $1`, [adminEmail]);
  if (taken.rows.length) return res.status(409).json({ error: `${adminEmail} is already used by another account. Choose a different login email.` });
  const chosen = String(req.body?.adminPassword ?? '');
  if (chosen && passwordProblem(chosen)) return res.status(400).json({ error: `${passwordProblem(chosen)} Or leave it empty for a random one.` });
  const adminPassword = chosen || tempPassword();

  let slug = slugify(r.school_name), code = codify(r.school_name);
  const slugDupe = await query(`SELECT 1 FROM organizations WHERE slug = $1`, [slug]);
  if (slugDupe.rows[0]) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const codeDupe = await query(`SELECT 1 FROM organizations WHERE org_code = $1`, [code]);
  if (codeDupe.rows[0]) code = `${code}${Math.floor(Math.random() * 90 + 10)}`;

  const scheme = /cbc/i.test(r.system_used || '') && !/8-4-4/i.test(r.system_used || '') ? 'cbc' : '844';

  let sections = SECTION_KEYS;                 // the platform admin can choose which sections this school uses while approving
  if (req.body?.sections !== undefined) {
    try { sections = normalizeSections(req.body.sections); } catch (e) { return res.status(400).json({ error: e.message }); }
  }
  const org = await query(
    `INSERT INTO organizations (name, slug, org_code, status, default_grading_scheme, support_email, support_phone, sections)
     VALUES ($1,$2,$3,'active',$4,$5,$6,$7) RETURNING *`,
    [r.school_name, slug, code, scheme, (r.contact_email || '').trim().toLowerCase() || null, r.contact_phone || null, sections]
  );

  const center = await query(
    `INSERT INTO centers (organization_id, name, center_code, location) VALUES ($1,'Main Campus',$2,$3) RETURNING *`,
    [org.rows[0].id, 'MAIN', r.location || null]
  );

  await query(
    `INSERT INTO admins (organization_id, full_name, email, password_hash, must_change_password) VALUES ($1,$2,$3,$4,true)`,
    [org.rows[0].id, `${r.school_name} Admin`, adminEmail, await hashPassword(adminPassword)]
  );

  await audit(req, { area: 'platform', action: 'org.approve', organizationId: org.rows[0].id, entity: 'school', entityId: org.rows[0].id, detail: { adminEmail } });
  await query(
    `UPDATE school_registrations SET status = 'approved', reviewed_by_id = $1, reviewed_at = now(), organization_id = $2 WHERE id = $3`,
    [req.auth.sub, org.rows[0].id, r.id]
  );

  // Email the credentials to the school's contact if email is set up; otherwise
  // the platform admin sees them on screen (shown once) and passes them on.
  const emailed = await sendEmail(r.contact_email, 'Your Acalyze school is ready',
    `Hello${r.contact_name ? ' ' + r.contact_name : ''},\n\n${r.school_name} has been approved on Acalyze.\n\nSign in${appUrl() ? ' at ' + appUrl() + '/app/' : ''}\nEmail: ${adminEmail}\nTemporary password: ${adminPassword}\n\nPlease change your password after signing in.\n\nThe Acalyze team`);

  res.status(201).json({
    emailed, emailedTo: emailed ? r.contact_email : null,
    organization: org.rows[0],
    center: center.rows[0],
    adminLogin: { email: adminEmail, password: adminPassword, note: 'Shown once. Send it to the school; they can change it after signing in.' },
  });
}));

// ---------- Organizations (schools) list, for the platform dashboard ----------
organizationsRouter.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT o.*,
      (SELECT count(*)::int FROM students s WHERE s.organization_id = o.id) AS student_count,
      (SELECT count(*)::int FROM centers c WHERE c.organization_id = o.id AND c.is_active = true) AS center_count,
      (SELECT status FROM invoices i WHERE i.organization_id = o.id ORDER BY i.created_at DESC LIMIT 1) AS latest_invoice_status
    FROM organizations o ORDER BY o.created_at DESC
  `);
  res.json(rows);
}));

// ---------- Platform dashboard numbers (charts on the platform admin's overview) ----------
organizationsRouter.get('/stats/summary', asyncHandler(async (req, res) => {
  const [totals, growth, topSchools, byPlan, invoices, pending] = await Promise.all([
    query(`SELECT
      (SELECT count(*)::int FROM organizations WHERE status = 'active') AS active_schools,
      (SELECT count(*)::int FROM organizations WHERE status = 'suspended') AS suspended_schools,
      (SELECT count(*)::int FROM students WHERE status = 'active') AS students,
      (SELECT count(*)::int FROM teachers) AS teachers,
      (SELECT count(*)::int FROM parents) AS parents,
      COALESCE((SELECT sum(o.rate_per_student * (SELECT count(*) FROM students s WHERE s.organization_id = o.id AND s.status = 'active'))
                FROM organizations o WHERE o.status = 'active' AND o.rate_per_student IS NOT NULL), 0)::float AS estimated_billing`),
    query(`SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, count(*)::int AS schools
           FROM organizations GROUP BY 1 ORDER BY 1`),
    query(`SELECT o.id, o.name, (SELECT count(*)::int FROM students s WHERE s.organization_id = o.id AND s.status = 'active') AS students
           FROM organizations o WHERE o.status = 'active' ORDER BY 3 DESC LIMIT 8`),
    query(`SELECT COALESCE(plan_name, 'No plan set') AS plan, count(*)::int AS schools FROM organizations WHERE status = 'active' GROUP BY 1 ORDER BY 2 DESC`),
    query(`SELECT status, count(*)::int AS n, COALESCE(sum(amount), 0)::float AS total FROM invoices GROUP BY status`),
    query(`SELECT count(*)::int AS n FROM school_registrations WHERE status = 'pending'`),
  ]);
  res.json({ totals: totals.rows[0], growth: growth.rows, topSchools: topSchools.rows, byPlan: byPlan.rows,
             invoices: invoices.rows, pendingRegistrations: pending.rows[0].n, paybill: process.env.PAYBILL_NUMBER || null });
}));

// ---------- Invoices: generated from the agreed plan x current student count ----------
organizationsRouter.get('/:id/invoices', asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT * FROM invoices WHERE organization_id = $1 ORDER BY created_at DESC`, [req.params.id]);
  res.json(rows);
}));

organizationsRouter.post('/:id/invoices', asyncHandler(async (req, res) => {
  const { periodLabel, dueDate } = req.body;
  if (!periodLabel) return res.status(400).json({ error: 'periodLabel is required, e.g. "2027" or "Term 1 2027"' });
  const org = (await query(`SELECT * FROM organizations WHERE id = $1`, [req.params.id])).rows[0];
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  if (!org.plan_name || org.rate_per_student == null) return res.status(400).json({ error: 'Set this school\'s plan and rate first.' });
  const count = (await query(`SELECT count(*)::int AS n FROM students WHERE organization_id = $1 AND status = 'active'`, [org.id])).rows[0].n;
  const amount = Math.round(Number(org.rate_per_student) * count * 100) / 100;
  const { rows } = await query(
    `INSERT INTO invoices (organization_id, period_label, plan_name, student_count, rate_per_student, amount, due_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [org.id, periodLabel, org.plan_name, count, org.rate_per_student, amount, dueDate || null]);
  res.status(201).json(rows[0]);
}));

// Manual confirmation: check the M-Pesa message, then mark it paid. (Automatic
// confirmation through Daraja is a later step — nothing here needs to change for it.)
organizationsRouter.patch('/invoices/:invoiceId/paid', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = $1 RETURNING *`, [req.params.invoiceId]);
  if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });
  res.json(rows[0]);
}));

organizationsRouter.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT * FROM organizations WHERE id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Organization not found' });
  res.json(rows[0]);
}));

// Set/update a school's plan — the per-student rate, tier name and billing
// cycle agreed after negotiation (see the Billing mockup's "Set plan" form).
organizationsRouter.patch('/:id/plan', asyncHandler(async (req, res) => {
  const { planName, ratePerStudent, billingCycle } = req.body;
  if (!planName || ratePerStudent == null) return res.status(400).json({ error: 'planName and ratePerStudent are required' });
  const { rows } = await query(
    `UPDATE organizations SET plan_name = $1, rate_per_student = $2, billing_cycle = COALESCE($3, billing_cycle)
     WHERE id = $4 RETURNING *`,
    [planName, ratePerStudent, billingCycle || null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Organization not found' });
  await audit(req, { area: 'platform', action: 'org.plan', organizationId: rows[0].id, entity: 'school', entityId: rows[0].id, detail: { planName, ratePerStudent } });
  res.json(rows[0]);
}));

// Which modules a school has. The platform admin ticks them; null goes back to following the plan.
organizationsRouter.get('/:id/modules', asyncHandler(async (req, res) => {
  const org = (await query(`SELECT plan_name, modules FROM organizations WHERE id = $1`, [req.params.id])).rows[0];
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  res.json({ catalog: MODULES, custom: !!org.modules, modules: featuresForOrgRow(org) });
}));

organizationsRouter.patch('/:id/modules', asyncHandler(async (req, res) => {
  let modules;
  try { modules = normalizeModules(req.body?.modules); } catch (e) { return res.status(400).json({ error: e.message }); }
  const { rows } = await query(`UPDATE organizations SET modules = $1 WHERE id = $2 RETURNING plan_name, modules`, [modules ? JSON.stringify(modules) : null, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Organization not found' });
  await audit(req, { area: 'platform', action: 'org.modules', organizationId: req.params.id, entity: 'school', entityId: req.params.id, detail: { modules } });
  res.json({ custom: !!rows[0].modules, modules: featuresForOrgRow(rows[0]) });
}));

// Which sections a school uses. A school only ever sees these (classes, teachers, subjects).
organizationsRouter.get('/:id/sections', asyncHandler(async (req, res) => {
  const org = (await query(`SELECT sections FROM organizations WHERE id = $1`, [req.params.id])).rows[0];
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  res.json({ catalog: SECTION_LABELS, sections: parseSections(org.sections) });
}));

organizationsRouter.patch('/:id/sections', asyncHandler(async (req, res) => {
  let sections;
  try { sections = normalizeSections(req.body?.sections); } catch (e) { return res.status(400).json({ error: e.message }); }
  // Switching a section off must not hide classes that already exist in it.
  const inUse = (await query(`SELECT DISTINCT section::text AS s FROM classes WHERE organization_id = $1`, [req.params.id])).rows.map((r) => r.s);
  const stuck = inUse.filter((s) => !sections.includes(s));
  if (stuck.length) return res.status(409).json({ error: `This school already has classes in ${stuck.join(', ')}. Remove or move them before switching that section off.` });
  const { rows } = await query(`UPDATE organizations SET sections = $1 WHERE id = $2 RETURNING sections`, [sections, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Organization not found' });
  await audit(req, { area: 'platform', action: 'org.sections', organizationId: req.params.id, entity: 'school', entityId: req.params.id, detail: { sections } });
  res.json({ sections: parseSections(rows[0].sections) });
}));

organizationsRouter.patch('/:id/status', asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const { rows } = await query(`UPDATE organizations SET status = $1 WHERE id = $2 RETURNING *`, [status, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Organization not found' });
  forgetOrgStatus(req.params.id);
  await audit(req, { area: 'platform', action: 'org.status', organizationId: req.params.id, entity: 'school', entityId: req.params.id, detail: { status } });
  res.json(rows[0]);
}));

organizationsRouter.patch('/:id/report-template', asyncHandler(async (req, res) => {
  const { template } = req.body;
  if (!['classic', 'modern'].includes(template)) return res.status(400).json({ error: 'template must be "classic" or "modern"' });
  const { rows } = await query(`UPDATE organizations SET report_card_template = $1 WHERE id = $2 RETURNING *`, [template, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Organization not found' });
  res.json(rows[0]);
}));
