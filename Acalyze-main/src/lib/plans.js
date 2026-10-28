import { query } from './db.js';
import { ALL_MODULES, MODULE_KEYS } from './modules.js';

// What each plan unlocks. The platform admin picks a plan per school (and sets
// its price); these rules turn that choice into real limits, enforced on the
// server. A school with NO plan set yet (just approved, rate not agreed) gets
// everything, so onboarding is never blocked by billing paperwork.
export const PLANS = {
  'Analytics':           { analytics: true, parents: false, chat: false, sms: false, calendar: true,  attendance: false, fees: false },
  'Analytics + Parents': { analytics: true, parents: true,  chat: false, sms: false, calendar: true,  attendance: true,  fees: false },
  'Full Suite':          { analytics: true, parents: true,  chat: true,  sms: true,  calendar: true,  attendance: true,  fees: true  },
  'Custom':              { analytics: true, parents: true,  chat: true,  sms: true,  calendar: true,  attendance: true,  fees: true  },
};
const ALL = { ...ALL_MODULES };

export function featuresForPlan(planName) {
  return planName ? (PLANS[planName] || ALL) : ALL;
}

// A school whose modules were ticked by the platform admin gets exactly those; otherwise its plan decides, as before.
export function featuresForOrgRow(org) {
  const m = org?.modules;
  if (m && typeof m === 'object') return Object.fromEntries(MODULE_KEYS.map((k) => [k, m[k] === true]));
  return featuresForPlan(org?.plan_name);
}

export async function featuresForOrg(organizationId) {
  const { rows } = await query(`SELECT plan_name, modules FROM organizations WHERE id = $1`, [organizationId]);
  return featuresForOrgRow(rows[0]);
}

export function requireFeature(feature) {
  return async (req, res, next) => {
    const f = await featuresForOrg(req.auth.organizationId);
    if (!f[feature]) return res.status(402).json({ error: `Your school's plan doesn't include this feature.`, feature });
    next();
  };
}
