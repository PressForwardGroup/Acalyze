import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const U = await import('../public/js/ui.js');
const R = await import('../public/js/views/reportcard.js');

test('esc neutralises markup and quotes', () => {
  assert.ok(!U.esc('<img src=x onerror=alert(1)>').includes('<'));
  assert.equal(U.esc('"a" & \'b\''), '&quot;a&quot; &amp; &#39;b&#39;');
});
test('charts render, escape their labels, and handle empty and single-point data', () => {
  const bar = U.barChart([{ label: '<img src=x>', value: 70 }, { label: 'B', value: 40 }]);
  assert.ok(bar.startsWith('<svg') && !bar.includes('<img'));
  assert.ok(U.barChart([]).includes('No data'));
  const line = U.lineChart(['T1', 'T2', 'T3'], [{ name: 'Mean', values: [50, null, 70] }]);
  assert.equal((line.match(/<circle/g) || []).length, 2, 'null points are skipped');
  assert.ok(!U.lineChart(['T1'], [{ name: 'm', values: [60] }]).includes('NaN'));
  assert.equal((U.donut([{ label: 'A', value: 3 }, { label: 'B', value: 1 }]).match(/<circle/g) || []).length, 2);
  assert.ok(U.donut([{ label: 'A', value: 0 }]).includes('No data'));
});
test('a calendar date shows as that exact day, whatever the timezone', () => {
  assert.match(U.fmtDate('2026-10-16'), /^16 Oct 2026$/); assert.match(U.fmtDate('2027-01-01'), /^01 Jan 2027$/); assert.equal(U.fmtDate(null), '—');
});
test('number and money formatting', () => {
  assert.equal(U.num(71.45), '71.5'); assert.equal(U.num(null), '—'); assert.equal(U.kes(336800), 'KSh 336,800');
});

const line = (name, code, taken, pct, g, pts, pos, counted = true) => ({ subjectId: name, name, code, taken, percent: pct, grade: g, points: pts, position: pos, remark: 'GOOD', isCounted: counted });
const card = (over = {}) => ({
  template: 'classic', scheme: '844', school: { name: 'Riverside <b>Academy</b>', motto: 'Press on', logoUrl: null },
  student: { id: 's1', name: 'Amina <script>alert(1)</script> Otieno', admissionNo: 'RVS-001', className: 'Form 3 West', kcpeMarks: 402 },
  lines: [line('Mathematics', '121', true, 80, 'A', 12, 1), line('English', '101', true, 71.4, 'B+', 10, 4), line('Physics', '232', false), line('Agriculture', '443', true, 20, 'E', 1, 30, false)],
  summary: { eligible: true, subjectsDone: 3, total: 151, mean: 75.5, totalPoints: 22, meanPoints: 11, grade: 'A-', remark: 'V.GOOD', position: 3, outOf: 210, classPosition: 1, classOutOf: 41, topPoints: 12, target: { value: 80.4, met: false } },
  teacherComment: 'Works hard.', classTeacher: { name: 'Mr. Kamau', phone: '0711' }, ...over });
const exam = { name: 'Term 2 End Exam', term: 'Term 2', academic_year: '2026' };

test('classic card: complete, escaped, and laid out like the printed form', () => {
  const h = R.classicCard(card(), exam);
  assert.ok(!h.includes('<script>alert') && !h.includes('<b>Academy') && h.includes('&lt;script&gt;'));
  for (const s of ['MOTTO: Press on', 'ACADEMIC PROGRESS TERMINAL REPORT FORM', 'TERM TWO', 'OUT OF: 210', '1 of 41', 'TARGET PURSUIT: NOT MET', "Principal's Signature", 'Works hard.', 'Mr. Kamau']) assert.ok(h.includes(s), s);
  assert.ok(h.includes('class="xc"') && h.includes('not counted in the total'), 'excluded subject is faded and explained');
  assert.ok(!/undefined|>null<|NaN/.test(h));
});
test('classic card: a student with no overall result shows W and the reason', () => {
  const s = { ...card().summary, eligible: false, reason: '5 subjects done (needs at least 7)', position: null, classPosition: null, total: null, mean: null, meanPoints: null, grade: null, remark: null, target: null };
  const h = R.classicCard(card({ summary: s }), exam);
  assert.ok(h.includes('POSITION: <b>W</b>') && h.includes('GRADE: <b>W</b>') && h.includes('5 subjects done'));
  assert.ok(!/undefined|NaN/.test(h));
});
test('CBC card is labelled GRADE, lists only subjects taken, and has no KCPE', () => {
  const h = R.classicCard(card({ scheme: 'cbc', student: { ...card().student, className: 'Grade 10 Blue', kcpeMarks: null }, lines: [line('English', '101', true, 66, 'ME1', 6, 2), line('Biology', '231', false)] }), exam);
  assert.ok(h.includes('GRADE: <b>Grade 10 Blue') && !h.includes('Biology') && !h.includes('KCPE MARKS'));
});
test('modern card has KPIs, a subject chart and a trend chart; template follows the school setting', () => {
  const h = R.modernCard(card({ template: 'modern' }), exam, undefined, [{ exam: { name: 'T1' }, mean: 60 }, { exam: { name: 'T2' }, mean: 75.5 }]);
  assert.ok(h.includes('Mean score') && (h.match(/<svg/g) || []).length === 2 && !h.includes('<script>alert'));
  assert.ok(R.renderCard(card({ template: 'modern' }), exam).includes('class="mc"') && R.renderCard(card(), exam).includes('class="rc"'));
});
test('term is read from the exam name', () => {
  assert.equal(R.termFromExam({ term: 'Term 1' }), 'TERM ONE'); assert.equal(R.termFromExam({ name: 'END TERM II- 2026' }), 'TERM TWO'); assert.equal(R.termFromExam({ name: 'Midyear' }), '');
});
