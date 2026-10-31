// The things a school can be given. The platform admin ticks these per school.
// "soon" ones can be ticked now so the choice is recorded, but do nothing until they are built.
export const MODULES = [
  { key: 'analytics', group: 'Academic', label: 'Results and analytics' },
  { key: 'parents', group: 'Academic', label: 'Parent accounts' },
  { key: 'chat', group: 'Academic', label: 'Parent and teacher messages' },
  { key: 'attendance', group: 'Academic', label: 'Attendance' },
  { key: 'calendar', group: 'Academic', label: 'Calendar' },
  { key: 'timetable', group: 'Academic', label: 'Timetable', soon: true },
  { key: 'exam_timetable', group: 'Academic', label: 'Exam timetable', soon: true },
  { key: 'duty_roster', group: 'Academic', label: 'Duty roster', soon: true },
  { key: 'fees', group: 'Finance', label: 'Student fees and payments' },
  { key: 'mpesa', group: 'Finance', label: 'M-Pesa payments (pay from the app, automatic matching)' },
  { key: 'accounts', group: 'Finance', label: 'School accounts: expenses, budget, cashbook' },
  { key: 'public_extras', group: 'Finance', label: 'Public-school extras: capitation, procurement, stores', soon: true },
  { key: 'sms', group: 'Messaging', label: 'SMS', soon: true },
];
export const MODULE_KEYS = MODULES.map((m) => m.key);
export const ALL_MODULES = Object.fromEntries(MODULE_KEYS.map((k) => [k, true]));

// Accepts what the platform admin sends; null means "go back to following the plan".
export function normalizeModules(input) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('modules must be an object of module: true/false');
  return Object.fromEntries(MODULE_KEYS.map((k) => [k, input[k] === true]));
}
