import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, resolveSubject } from '../src/lib/subjectResolver.js';
import { papersFor, resolvePart, subjectPercent, PAPERS } from '../src/lib/papers.js';
import { pointsToPercent } from '../src/lib/grading.js';

const idx = buildIndex({});
const r = (h, className) => resolveSubject(h, idx, { className });

test('Composition is English Paper 2 in junior but Paper 3 in senior 8-4-4', () => {
  const j = r('COMPOSITION', 'GRD 8 LOVE'); assert.deepEqual([j.status, j.subject, j.paper.no, j.paper.code, j.section.max], ['part', 'English', 2, '901/2', 15]);
  const s = r('COMPOSITION', 'Form 4'); assert.deepEqual([s.status, s.subject, s.paper.no, s.paper.code], ['part', 'English', 3, '101/3']);
});
test('Insha is Kiswahili Paper 2 in junior but Paper 1 in senior 8-4-4', () => {
  assert.equal(r('INSHA', 'GRD 9 JOY').paper.no, 2); assert.equal(r('INSHA', 'Form 3').paper.no, 1);
  assert.equal(r('LUGHA', 'GRD 9 JOY').paper.no, 1); assert.equal(r('LUGHA', 'Form 3').paper.no, 2);
  assert.equal(r('FASIHI', 'Form 4').paper.no, 3);
});
test('"Paper 1" means a different paper in each band, for the same subject', () => {
  assert.equal(r('KARATASI 1', 'GRD 7 LOVE').paper.name, 'Lugha');
  assert.equal(r('KARATASI 1', 'Form 4').paper.name, 'Insha');
  assert.equal(r('ENG PP1', 'GRD 8 LOVE').paper.no, 1); assert.equal(r('ENG PP2', 'GRD 8 LOVE').paper.no, 2);
});
test('without a class the part is still found, but the paper is not guessed', () => {
  const p = resolveSubject('COMPOSITION', idx, {}); assert.equal(p.subject, 'English'); assert.equal(p.paper, undefined);
});
test('Comp stays Computer Studies in senior, and comprehension is a paper section there', () => {
  assert.equal(r('COMP', 'Form 3').subject, 'Computer Studies'); assert.equal(r('COMP', 'Form 3').status, 'matched');
  assert.equal(r('COMPREHENSION', 'Form 3').paper.no, 2);
});
test('primary parts are recognised, but their papers are set by the school', () => {
  const g = r('GRAMMAR', 'GRD 4 RED'); assert.equal(g.status, 'part'); assert.equal(g.subject, 'English'); assert.equal(g.paper, undefined);
});
test('the KNEC paper totals', () => {
  const total = (s, b) => papersFor(s, b).reduce((t, p) => t + p.max, 0);
  assert.equal(total('English', 'JUNIOR'), 100); assert.equal(total('Kiswahili', 'JUNIOR'), 100);
  assert.equal(total('English', '844'), 200); assert.equal(total('Kiswahili', '844'), 200);
  for (const [s, byBand] of Object.entries(PAPERS)) for (const [b, ps] of Object.entries(byBand)) for (const p of ps) {
    const secs = p.sections.filter((x) => x.max != null).reduce((t, x) => t + x.max, 0);
    if (p.sections.length && p.sections.every((x) => x.max != null)) assert.equal(secs, p.max, `${s} ${b} paper ${p.no} sections add up`);
  }
});
test('a subject percentage from its papers', () => {
  assert.deepEqual(subjectPercent('English', 'JUNIOR', { 1: 37, 2: 33 }), { percent: 70, outOf: 100 });          // the NDOVOINI Grade 7-9 sheets: Paper 1 + Paper 2
  assert.deepEqual(subjectPercent('Kiswahili', '844', { 1: 28, 2: 56, 3: 52 }), { percent: 68, outOf: 200 });
  assert.equal(subjectPercent('English', 'JUNIOR', { 1: 40 }).percent, 80);                                       // only Paper 1 sat
  assert.equal(subjectPercent('English', 'LOWER', { 1: 10 }), null);                                              // primary papers are school-defined
});
test('resolvePart reads section names too', () => {
  const h = resolvePart('English', 'Functional Writing', '844'); assert.equal(h.paper.no, 1); assert.equal(h.section.max, 20);
});
test('typed levels become a percentage inside their KNEC range, not points / 8', () => {
  assert.equal(pointsToPercent('cbc', 6), 66);        // ME1 is 58-74%, was 75%
  assert.equal(pointsToPercent('cbc', 8), 95); assert.equal(pointsToPercent('cbc', 7), 82); assert.equal(pointsToPercent('cbc', 5), 49);
  assert.ok(pointsToPercent('cbc', 5.5) > 49 && pointsToPercent('cbc', 5.5) < 66);
  assert.ok(pointsToPercent('844', 12) > 79.5 && pointsToPercent('844', 12) <= 100);
  assert.equal(pointsToPercent('cbc', null), null);
});
