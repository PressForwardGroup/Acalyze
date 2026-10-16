import { Router } from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { featuresForPlan, PLANS } from '../lib/plans.js';

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
              defaultGradingScheme: org.default_grading_scheme, code: org.org_code },
    subscription: {
      planName: org.plan_name, features: featuresForPlan(org.plan_name), allPlans: Object.keys(PLANS), ratePerStudent: rate, billingCycle: org.billing_cycle, activeStudents: students,
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
  const { rows } = await query(
    `UPDATE organizations SET motto = COALESCE($1, motto), logo_url = COALESCE($2, logo_url),
       report_card_template = COALESCE($3, report_card_template), default_grading_scheme = COALESCE($4, default_grading_scheme)
     WHERE id = $5 RETURNING name, motto, logo_url, report_card_template, default_grading_scheme`,
    [motto ?? null, logoUrl ?? null, reportCardTemplate || null, defaultGradingScheme || null, req.auth.organizationId]);
  res.json(rows[0]);
}));
