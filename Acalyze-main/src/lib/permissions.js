// Who may do what. One table, used by the server (requirePerm) and sent to the app so screens match.
//   admin      school admin or deputy: runs the school day to day, cannot see finance
//   principal  principal, head teacher or owner: sees the whole school, full authority over finance
//   finance    finance officer (bursar, accounts clerk): runs fees and money, sees no academic records
//   teacher, parent: unchanged
export const STAFF_KINDS = ['admin', 'principal', 'finance'];
export const KIND_LABELS = { admin: 'School admin', principal: 'Principal', finance: 'Finance officer' };

export const PERMS = {
  'academic.view': ['admin', 'principal'],
  'academic.edit': ['admin'],
  'finance.view': ['principal', 'finance'],
  'finance.edit': ['principal', 'finance'],
  'finance.approve': ['principal'],
  'finance.settings': ['principal', 'finance'],
  'staff.manage': ['admin', 'principal'],
  'audit.view': ['admin', 'principal'],
  'audit.view_finance': ['principal'],
};

export const can = (role, perm) => !!PERMS[perm]?.includes(role);
export const permissionsFor = (role) => Object.keys(PERMS).filter((p) => can(role, p));

// A request counts as a read when it cannot change anything.
export const isRead = (method) => method === 'GET' || method === 'HEAD';

// Is `role` allowed through a route guarded by requireRole(...roles)?
//  - the principal can look at everything an admin can (read only), but never change it
//  - the finance officer can only list classes and students (the fees screen needs them)
export function roleAllowed(role, roles, method, baseUrl = '', path = '/') {
  if (roles.includes(role)) return true;
  if (role === 'principal' && roles.includes('admin') && isRead(method)) return true;
  if (role === 'finance' && roles.includes('admin') && isRead(method) && path === '/' && ['/classes', '/students'].includes(baseUrl)) return true;
  return false;
}
