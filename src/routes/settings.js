import { parseSections } from '../lib/sections.js';
import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { featuresForOrgRow, PLANS } from '../lib/plans.js';
import { audit } from '../lib/audit.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth, requireRole('admin'));

// The school's own settings + its subscription page (plan, what is due, how to pay, history).
settingsRouter.get('/', asyncHandler(async (req, res) => {
  const org = (await query(`SELECT * FROM organizations WHERE id = $1`, [req.auth.organizationId])).rows[0];
  const students = (await query(`SELECT count(*)::int AS n FROM students WHERE organization_id = $1 AND status = 'active'`, [org.id])).rows[0].n;
  const invoices = (await query(`SELECT id, period_label, plan_name, student_count, rate_per_student, amount, due_date, status, paid_at
                                 FROM invoices WHERE organization_id = $1 ORDER BY created_at DESC`, [org.id])).rows;
  const rate = org.rate_per_student == null ? null : Number(org.rate_per_student);
  res.json({
    school: { name: org.name, motto: org.motto, logoUrl: org.logo_url, reportCardTemplate: org.report_card_template,
              defaultGradingScheme: org.default_grading_scheme, code: org.org_code, sections: parseSections(org.sections),
              support: { email: org.support_email, phone: org.support_phone, note: org.support_note } },
    subscription: {
      planName: org.plan_name, features: featuresForOrgRow(org), allPlans: Object.keys(PLANS), ratePerStudent: rate, billingCycle: org.billing_cycle, activeStudents: students,
      estimatedAmount: rate == null ? null : Math.round(rate * students * 100) / 100,
      // One Paybill for the whole platform; each school uses its own code as the account number.
      payment: { paybill: process.env.PAYBILL_NUMBER || null, accountNumber: org.org_code },
      invoices, nextDue: invoices.find((i) => i.status !== 'paid') || null,
    },
  });
}));

// A school chooses its own look and defaults. Name, plan and price are the platform's to change.
settingsRouter.patch('/', asyncHandler(async (req, res) => {
  const { motto, logoUrl, reportCardTemplate, defaultGradingScheme } = req.body;
  if (reportCardTemplate && !['classic', 'modern'].includes(reportCardTemplate)) return res.status(400).json({ error: 'reportCardTemplate must be "classic" or "modern"' });
  if (defaultGradingScheme && !['cbc', '844'].includes(defaultGradingScheme)) return res.status(400).json({ error: 'defaultGradingScheme must be "cbc" or "844"' });
  // Support contact (shown to this school's parents): only changed when sent; an empty value clears it.
  const cur = (await query(`SELECT support_email, support_phone, support_note FROM organizations WHERE id = $1`, [req.auth.organizationId])).rows[0];
  const pick = (key, col, max) => (key in req.body ? String(req.body[key] ?? '').trim().slice(0, max) || null : cur[col]);
  const supportEmail = pick('supportEmail', 'support_email', 200), supportPhone = pick('supportPhone', 'support_phone', 40), supportNote = pick('supportNote', 'support_note', 200);
  if (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) return res.status(400).json({ error: 'Enter a valid support email, or leave it empty.' });
  const { rows } = await query(
    `UPDATE organizations SET motto = COALESCE($1, motto), logo_url = COALESCE($2, logo_url),
       report_card_template = COALESCE($3, report_card_template), default_grading_scheme = COALESCE($4, default_grading_scheme),
       support_email = $6, support_phone = $7, support_note = $8
     WHERE id = $5 RETURNING name, motto, logo_url, report_card_template, default_grading_scheme, support_email, support_phone, support_note`,
    [motto ?? null, logoUrl ?? null, reportCardTemplate || null, defaultGradingScheme || null, req.auth.organizationId, supportEmail, supportPhone, supportNote]);
  await audit(req, { area: 'academic', action: 'settings.update', entity: 'settings', detail: { changed: Object.keys(req.body || {}) } });
  res.json(rows[0]);
}));
