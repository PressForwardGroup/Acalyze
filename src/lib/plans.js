import { query } from './db.js';

// What each plan unlocks. The platform admin picks a plan per school (and sets
// its price); these rules turn that choice into real limits, enforced on the
// server. A school with NO plan set yet (just approved, rate not agreed) gets
// everything, so onboarding is never blocked by billing paperwork.
export const PLANS = {
  'Analytics':           { analytics: true, parents: false, chat: false, sms: false },
  'Analytics + Parents': { analytics: true, parents: true,  chat: false, sms: false },
  'Full Suite':          { analytics: true, parents: true,  chat: true,  sms: true  },
  'Custom':              { analytics: true, parents: true,  chat: true,  sms: true  },
};
const ALL = { analytics: true, parents: true, chat: true, sms: true };

export function featuresForPlan(planName) {
  return planName ? (PLANS[planName] || ALL) : ALL;
}

export async function featuresForOrg(organizationId) {
  const { rows } = await query(`SELECT plan_name FROM organizations WHERE id = $1`, [organizationId]);
  return featuresForPlan(rows[0]?.plan_name);
}

export function requireFeature(feature) {
  return async (req, res, next) => {
    const f = await featuresForOrg(req.auth.organizationId);
    if (!f[feature]) return res.status(402).json({ error: `Your school's plan doesn't include this feature.`, feature });
    next();
  };
}
