// Booking calendar rules. Pure functions, so they are easy to test.
// Times are East Africa Time (Nairobi, UTC+3, no daylight saving), the same all year.
const EAT = 3 * 3600_000;
const pad = (n) => String(n).padStart(2, '0');
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const KINDS = { in_person: 'Face to face', video: 'Google Meet', phone: 'Phone call' };

// Opening hours come from settings, with sensible defaults (Mon-Fri, 9:00-17:00, 30-minute slots).
export function bookingConfig(env = process.env) {
  const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    weekdays: String(env.BOOKING_DAYS || '1,2,3,4,5').split(',').map((x) => Number(x.trim())).filter((x) => x >= 0 && x <= 6),
    startHour: num(env.BOOKING_START_HOUR, 9),
    endHour: num(env.BOOKING_END_HOUR, 17),
    slotMinutes: Math.max(10, num(env.BOOKING_SLOT_MINUTES, 30)),
    leadHours: num(env.BOOKING_LEAD_HOURS, 4),
    maxDays: Math.min(90, num(env.BOOKING_MAX_DAYS, 30)),
  };
}

const timeLabel = (h, m) => `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;

// Free slots grouped by day. `taken` is a Set of start times (epoch ms) that are already booked.
export function generateSlots(now = new Date(), cfg = bookingConfig(), taken = new Set()) {
  const local = new Date(now.getTime() + EAT);           // Nairobi wall-clock, read with the UTC getters
  const y = local.getUTCFullYear(), mo = local.getUTCMonth(), d0 = local.getUTCDate();
  const earliest = now.getTime() + cfg.leadHours * 3600_000;
  const days = [];
  for (let i = 0; i <= cfg.maxDays; i++) {
    const day = new Date(Date.UTC(y, mo, d0 + i));
    if (!cfg.weekdays.includes(day.getUTCDay())) continue;
    const slots = [];
    for (let min = cfg.startHour * 60; min + cfg.slotMinutes <= cfg.endHour * 60; min += cfg.slotMinutes) {
      const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, min) - EAT;
      if (start < earliest || taken.has(start)) continue;
      slots.push({ startsAt: new Date(start).toISOString(), label: timeLabel(Math.floor(min / 60), min % 60) });
    }
    if (slots.length) days.push({ date: `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`, weekday: WEEKDAYS[day.getUTCDay()], slots });
  }
  return days;
}

// "Mon 19 Oct 2026, 9:00 AM (East Africa Time)" for emails and messages.
export function formatWhen(date) {
  const l = new Date(new Date(date).getTime() + EAT);
  return `${WEEKDAYS[l.getUTCDay()]} ${l.getUTCDate()} ${MONTHS[l.getUTCMonth()]} ${l.getUTCFullYear()}, ${timeLabel(l.getUTCHours(), l.getUTCMinutes())} (East Africa Time)`;
}
