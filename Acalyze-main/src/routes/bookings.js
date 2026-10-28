import { Router } from 'express';
import { query } from '../lib/db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js';
import { sendEmail, appUrl } from '../lib/mail.js';
import { KINDS, bookingConfig, generateSlots, formatWhen } from '../lib/booking.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v, n) => String(v ?? '').trim().slice(0, n);
const siteUrl = () => (process.env.SITE_URL || '').replace(/\/+$/, '');
const ownerEmail = () => process.env.NOTIFY_EMAIL || process.env.PLATFORM_ADMIN_EMAIL || '';

async function takenSlots(from) {
  const { rows } = await query(`SELECT starts_at FROM bookings WHERE starts_at >= $1 AND status IN ('new','confirmed')`, [from]);
  return new Set(rows.map((r) => new Date(r.starts_at).getTime()));
}

// What the person needs to know about how the meeting will happen.
function howItHappens(b) {
  if (b.kind === 'video') return process.env.MEET_LINK ? `Join on Google Meet: ${process.env.MEET_LINK}` : 'We will send you the Google Meet link.';
  if (b.kind === 'phone') return `We will call you on ${b.phone}.`;
  return process.env.OFFICE_ADDRESS ? `Meet us at: ${process.env.OFFICE_ADDRESS}` : 'We will confirm the meeting place with you.';
}

// ---------- public (no sign-in): used by the website ----------
export const publicBookingsRouter = Router();

publicBookingsRouter.get('/availability', asyncHandler(async (req, res) => {
  const cfg = bookingConfig(), now = new Date();
  res.json({ timezone: 'East Africa Time (Nairobi)', slotMinutes: cfg.slotMinutes, days: generateSlots(now, cfg, await takenSlots(now)) });
}));

publicBookingsRouter.get('/contact', (req, res) => {
  res.json({ email: process.env.SUPPORT_EMAIL || null, phone: process.env.SUPPORT_PHONE || null, address: process.env.OFFICE_ADDRESS || null, siteUrl: siteUrl() || null });
});

publicBookingsRouter.post('/bookings', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.status(201).json({ ok: true });          // hidden field only bots fill in
  const kind = String(b.kind || '');
  const name = clean(b.name, 100), school = clean(b.school, 150), email = clean(b.email, 200).toLowerCase();
  const phone = clean(b.phone, 40), message = clean(b.message, 1000);
  if (!KINDS[kind]) return res.status(400).json({ error: 'Choose how you would like to meet.' });
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (phone && !/^[+\d][\d\s()+-]{6,}$/.test(phone)) return res.status(400).json({ error: 'Please enter a valid phone number.' });
  if (kind === 'phone' && !phone) return res.status(400).json({ error: 'Please enter the phone number we should call.' });

  const when = new Date(String(b.startsAt || ''));
  if (Number.isNaN(when.getTime())) return res.status(400).json({ error: 'Choose a date and time.' });
  const cfg = bookingConfig(), now = new Date();
  const free = generateSlots(now, cfg, await takenSlots(now)).some((d) => d.slots.some((s) => s.startsAt === when.toISOString()));
  if (!free) return res.status(409).json({ error: 'Sorry, that time is no longer available. Please pick another.' });

  const ends = new Date(when.getTime() + cfg.slotMinutes * 60_000);
  let row;
  try {
    row = (await query(
      `INSERT INTO bookings (starts_at, ends_at, kind, name, school, email, phone, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, starts_at, ends_at, kind`,
      [when, ends, kind, name, school || null, email, phone || null, message || null])).rows[0];
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Sorry, someone just took that time. Please pick another.' });
    throw e;
  }
  res.status(201).json({ ok: true, startsAt: row.starts_at, endsAt: row.ends_at, when: formatWhen(when), kind: KINDS[kind] });

  // After the person has their answer: alert you, and acknowledge them. Failures here never affect the booking.
  const link = appUrl() ? `\n\nOpen it: ${appUrl()}/app/#/app/bookings` : '';
  if (ownerEmail()) {
    sendEmail(ownerEmail(), `New booking: ${name}, ${formatWhen(when)}`,
      `${name}${school ? ' (' + school + ')' : ''} booked a ${KINDS[kind]}.\n\nWhen: ${formatWhen(when)}\nEmail: ${email}\nPhone: ${phone || '-'}\n${message ? '\nMessage: ' + message : ''}${link}`).catch(() => {});
  }
  sendEmail(email, 'We received your Acalyze booking request',
    `Hello ${name},\n\nThank you. We received your request for a ${KINDS[kind]} on ${formatWhen(when)}. We will confirm it shortly.\n\nThe Acalyze team`).catch(() => {});
}));

// ---------- platform admin: the Bookings page ----------
export const bookingsRouter = Router();
bookingsRouter.use(requireAuth, requirePlatformAdmin);

bookingsRouter.get('/count', asyncHandler(async (req, res) => {
  res.json({ n: (await query(`SELECT count(*)::int AS n FROM bookings WHERE status = 'new'`)).rows[0].n });
}));

const VIEWS = {
  new: `SELECT * FROM bookings WHERE status = 'new' ORDER BY starts_at`,
  upcoming: `SELECT * FROM bookings WHERE status = 'confirmed' AND ends_at >= now() ORDER BY starts_at`,
  history: `SELECT * FROM bookings WHERE NOT (status = 'new' OR (status = 'confirmed' AND ends_at >= now())) ORDER BY starts_at DESC LIMIT 200`,
};
bookingsRouter.get('/', asyncHandler(async (req, res) => {
  res.json((await query(VIEWS[req.query.view] || VIEWS.new)).rows);
}));

bookingsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const status = String(req.body?.status || '');
  if (!['confirmed', 'declined', 'done', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Unknown status.' });
  const { rows } = await query(`UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *`, [status, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Booking not found.' });
  const b = rows[0];
  if (status === 'confirmed') {
    sendEmail(b.email, 'Your Acalyze meeting is confirmed',
      `Hello ${b.name},\n\nYour ${KINDS[b.kind]} is confirmed for ${formatWhen(b.starts_at)}.\n\n${howItHappens(b)}\n\nThe Acalyze team`).catch(() => {});
  } else if (status === 'declined') {
    sendEmail(b.email, 'About your Acalyze booking',
      `Hello ${b.name},\n\nSorry, we cannot do ${formatWhen(b.starts_at)}.${siteUrl() ? ` Please choose another time at ${siteUrl()}/book/` : ''}\n\nThe Acalyze team`).catch(() => {});
  }
  res.json(b);
}));
