import { verifyToken } from '../lib/auth.js';
import { orgIsActive } from '../lib/orgStatus.js';
import { sessionRevoked } from '../lib/sessions.js';
import { roleAllowed, can, isRead } from '../lib/permissions.js';

// Attaches req.auth = { organizationId, centerId, role, sub, section? } from
// a verified JWT. organizationId is the ONLY source of truth for which
// school's data a request can touch — never read from the request body,
// query string, or URL, so a client can't pass a different organizationId
// to reach another school's data. platform_admin has organizationId = null
// (it is not scoped to any one school) and must switch into one explicitly
// via /auth/platform/view-org before touching org-scoped routes, the same
// pattern MOHI used for it_support switching centers.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    req.auth = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  // Reset-only tokens (first-login password change) are not valid for API calls.
  if (/_reset$/.test(req.auth.role)) return res.status(401).json({ error: 'Please finish setting your password first' });
  // "Sign out everywhere", or an account that was switched off, ends every older token.
  if (await sessionRevoked(req.auth)) return res.status(401).json({ error: 'You were signed out. Please sign in again.' });
  // A suspended school is locked out within 30 seconds, whatever token it holds.
  if (req.auth.organizationId && !(await orgIsActive(req.auth.organizationId))) {
    return res.status(403).json({ error: "This school's account is not active. Please contact Acalyze support." });
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    // platform_admin can act as an admin ONLY after explicitly switching
    // into an org (see auth.js /platform/view-org) — unlike MOHI's
    // it_support, it is never silently granted every org's permissions,
    // because an unrelated school's admin rights are not platform_admin's
    // by default. Once switched, req.auth.role is rewritten to 'admin'
    // for that request's lifetime, so this check needs no special case.
    if (req.auth?.role === 'principal' && roles.includes('admin') && !isRead(req.method)) {
      return res.status(403).json({ error: 'The principal can view this but not change it. Ask the school admin.' });
    }
    if (!req.auth || !roleAllowed(req.auth.role, roles, req.method, req.baseUrl, req.path)) {
      return res.status(403).json({ error: `This action requires one of: ${roles.join(', ')}` });
    }
    next();
  };
}

// Platform-only routes (registrations queue, organizations list, billing).
export function requirePlatformAdmin(req, res, next) {
  if (!req.auth || req.auth.role !== 'platform_admin') {
    return res.status(403).json({ error: 'Platform admin only' });
  }
  next();
}

// Guard by what a person is allowed to do (see lib/permissions.js) rather than by role name.
export function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.auth || !can(req.auth.role, perm)) return res.status(403).json({ error: 'Your account is not allowed to do this.' });
    next();
  };
}
