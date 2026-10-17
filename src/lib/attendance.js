export const STATUSES = ['present', 'absent', 'late', 'excused'];

// "2026-10-16" -> the same string if it is a real calendar date and not more than a
// day in the future (a teacher marking tomorrow's register early is fine, next month isn't).
export function validDay(str, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(str || ''))) return null;
  const d = new Date(`${str}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== str) return null;
  const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return d.getTime() <= tomorrow ? str : null;
}

export const today = (now = new Date()) => now.toISOString().slice(0, 10);
export const daysAgo = (n, now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - n)).toISOString().slice(0, 10);

// Attendance rate = (present + late) out of everything recorded. Late still came to school;
// excused and absent did not. Returns null when nothing has been recorded (not 0%).
export function rate({ present = 0, late = 0, absent = 0, excused = 0 }) {
  const total = present + late + absent + excused;
  return total ? Math.round(((present + late) / total) * 1000) / 10 : null;
}

export function summarize(records) {
  const c = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const r of records) if (r.status in c) c[r.status]++;
  return { ...c, total: records.length, rate: rate(c) };
}
