import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, resolveSubject, normaliseKey } from '../src/lib/subjectResolver.js';

const idx = buildIndex({});
const r = (h, scope) => resolveSubject(h, idx, scope);

test('spelling variants of one name collapse to one key', () => {
  assert.equal(normaliseKey('SCIE&TECNO'), normaliseKey('scie & tecno')); assert.equal(normaliseKey('AGRI&NUT'), normaliseKey('Agri and Nut'));
  assert.equal(normaliseKey('AGRI/NUT'), normaliseKey('AGRI&NUT'));
});
test('the headers in the three workbooks resolve without asking', () => {
  assert.equal(r('HAG', { className: 'Form 3' }).subject, 'History and Government');
  assert.equal(r('HAG', { className: 'Grade 10' }).subject, 'History and Citizenship');
  assert.equal(r('AGR', { className: 'Form 4' }).subject, 'Agriculture');
  assert.equal(r('BUS', { className: 'Form 3' }).subject, 'Business Studies');
  assert.equal(r('SCIE&TECNO', { className: 'GRD 5 RED' }).subject, 'Science and Technology');
  assert.equal(r('SCIE&TECHNO', { className: 'GRD 5 RED' }).status, 'matched');
  assert.equal(r('AGRIC &NUT', { className: 'GRD 8 LOVE' }).subject, 'Agriculture and Nutrition');
  assert.equal(r('INTER SCIENCE', { className: 'GRD 9 JOY' }).subject, 'Integrated Science');
  assert.equal(r('CAS', { className: 'GRD 7 LOVE' }).subject, 'Creative Arts and Sports');
  assert.equal(r('CORE MAT', { className: 'Grade 10' }).subject, 'Core Mathematics');
  assert.equal(r('EST MATHS', { className: 'Grade 10' }).subject, 'Essential Mathematics');
  assert.equal(r('SOCIAL', { className: 'GRD 5 BLUE' }).subject, 'Social Studies');
});
test('the same short name means different things in different sections', () => {
  assert.equal(r('COMP', { className: 'Form 3' }).subject, 'Computer Studies');
  const p = r('COMP', { className: 'GRD 5 RED' });
  assert.equal(p.status, 'part'); assert.equal(p.subject, 'English');                    // Comprehension, a part of English
  assert.equal(r('CRE', { className: 'Form 4' }).subject, 'Christian Religious Education');
  assert.equal(r('CRE', { className: 'GRD 4 RED' }).subject, 'Religious Education');
});
test('papers and parts belong to their subject', () => {
  assert.deepEqual([r('LUGHA', { className: 'GRD 4 RED' }).status, r('LUGHA', { className: 'GRD 4 RED' }).subject], ['part', 'Kiswahili']);
  assert.equal(r('ENG PP2', { className: 'GRD 8 LOVE' }).status, 'part');
  assert.equal(r('JUMLA', { className: 'GRD 8 LOVE' }).subject, 'Kiswahili');
});
test('a teacher\'s short name is suggested, not silently accepted', () => {
  const k = r('Kisw', { className: 'GRD 8 LOVE' });
  assert.equal(k.status, 'matched'); assert.equal(k.subject, 'Kiswahili');                // KISW is a known short name
  const s = r('Kiswa', { className: 'GRD 8 LOVE' });
  assert.equal(s.status, 'suggested'); assert.equal(s.subject, 'Kiswahili');
  assert.equal(r('Scince', { className: 'GRD 9 JOY' }).subject, 'Integrated Science');
});
test('something unknown is asked about, with suggestions where there are any', () => {
  const u = r('XYZQ', { className: 'GRD 8 LOVE' }); assert.equal(u.status, 'unknown'); assert.deepEqual(u.suggestions, []);
  assert.equal(r('', {}).status, 'unknown');
});
test('a saved answer wins and is never asked again', () => {
  const mine = buildIndex({ saved: [{ alias: 'Reading Time', subject: 'English' }] });
  assert.deepEqual([resolveSubject('reading-time', mine, {}).status, resolveSubject('reading-time', mine, {}).subject], ['matched', 'English']);
});
test('a school without the section does not get its subjects', () => {
  const primaryOnly = buildIndex({ sections: ['PRIMARY'] });
  assert.notEqual(resolveSubject('Biology', primaryOnly, {}).status, 'matched');
  assert.equal(resolveSubject('Science and Technology', primaryOnly, {}).status, 'matched');
});
