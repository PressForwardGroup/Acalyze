import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingConfig, generateSlots, formatWhen, KINDS } from '../src/lib/booking.js';

const cfg = bookingConfig({});   // defaults: Mon-Fri, 9:00-17:00, 30 minutes, 4 hours notice, 30 days
const flat = (days) => days.flatMap((d) => d.slots.map((s) => s.startsAt));

test('booking: the three meeting kinds are offered', () => {
  assert.deepEqual(Object.keys(KINDS), ['in_person', 'video', 'phone']);
});

test('booking: slots follow Nairobi time (9:00 AM EAT is 06:00 UTC)', () => {
  const days = generateSlots(new Date('2026-10-19T00:00:00Z'), cfg);   // Monday 03:00 in Nairobi
  assert.equal(days[0].date, '2026-10-19');
  assert.equal(days[0].slots[0].startsAt, '2026-10-19T06:00:00.000Z');
  assert.equal(days[0].slots[0].label, '9:00 AM');
  assert.equal(days[0].slots.at(-1).label, '4:30 PM');
  assert.equal(days[0].slots.length, 16);
});

test('booking: weekends are never offered', () => {
  const days = generateSlots(new Date('2026-10-19T00:00:00Z'), cfg);
  assert.ok(days.every((d) => !['Sat', 'Sun'].includes(d.weekday)));
  assert.ok(!days.some((d) => d.date === '2026-10-24' || d.date === '2026-10-25'));
});

test('booking: nothing sooner than the notice period', () => {
  const now = new Date('2026-10-19T06:00:00Z');                        // Monday 9:00 AM Nairobi
  const first = generateSlots(now, cfg)[0].slots[0].startsAt;
  assert.ok(new Date(first).getTime() >= now.getTime() + 4 * 3600_000);
});

test('booking: a taken slot disappears', () => {
  const taken = new Set([Date.parse('2026-10-19T06:00:00.000Z')]);
  const all = flat(generateSlots(new Date('2026-10-19T00:00:00Z'), cfg, taken));
  assert.ok(!all.includes('2026-10-19T06:00:00.000Z'));
  assert.ok(all.includes('2026-10-19T06:30:00.000Z'));
});

test('booking: opening hours and slot length come from settings', () => {
  const c = bookingConfig({ BOOKING_DAYS: '6', BOOKING_START_HOUR: '10', BOOKING_END_HOUR: '12', BOOKING_SLOT_MINUTES: '60' });
  const days = generateSlots(new Date('2026-10-19T00:00:00Z'), c);
  assert.ok(days.every((d) => d.weekday === 'Sat'));
  assert.deepEqual(days[0].slots.map((s) => s.label), ['10:00 AM', '11:00 AM']);
});

test('booking: dates read nicely in emails', () => {
  assert.equal(formatWhen('2026-10-19T06:00:00.000Z'), 'Mon 19 Oct 2026, 9:00 AM (East Africa Time)');
  assert.equal(formatWhen('2026-10-19T13:30:00.000Z'), 'Mon 19 Oct 2026, 4:30 PM (East Africa Time)');
});
