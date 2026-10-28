import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogueFor, CATALOGUE, bandFor, codeFor, SECTION_KEYS } from '../src/lib/curriculum.js';

const names = (sections) => catalogueFor(sections).map((r) => r.name);

test('all 31 KNEC KCSE subject codes are present, and only on senior 8-4-4 rows', () => {
  const coded = catalogueFor().filter((r) => r.code);
  assert.equal(coded.length, 31);
  const byCode = Object.fromEntries(coded.map((r) => [r.code, r.name]));
  assert.equal(byCode['101'], 'English'); assert.equal(byCode['311'], 'History and Government');
  assert.equal(byCode['312'], 'Geography'); assert.equal(byCode['313'], 'Christian Religious Education');
  assert.equal(byCode['443'], 'Agriculture'); assert.equal(byCode['451'], 'Computer Studies'); assert.equal(byCode['565'], 'Business Studies');
  assert.equal(catalogueFor(['PRIMARY', 'JUNIOR']).filter((r) => r.code).length, 0, 'no codes outside the senior section');
});
test('junior school has exactly the nine KJSEA learning areas', () => {
  const j = names(['JUNIOR']).sort();
  assert.deepEqual(j, ['Agriculture and Nutrition', 'Creative Arts and Sports', 'English', 'Integrated Science', 'Kiswahili', 'Mathematics',
    'Pre-Technical Studies', 'Religious Education', 'Social Studies'].sort());
});
test('a school sees only the sections it uses', () => {
  assert.ok(!names(['PRIMARY']).includes('Pre-Technical Studies'));
  assert.ok(!names(['JUNIOR']).includes('Biology'));
  assert.ok(names(['SENIOR']).includes('Biology') && names(['SENIOR']).includes('Core Mathematics') && names(['SENIOR']).includes('Community Service Learning'));
  assert.ok(names(['PRIMARY']).includes('Science and Technology') && names(['PRIMARY']).includes('Language Activities'));
});
test('shared subjects are not tied to one section; section-only ones are', () => {
  const all = Object.fromEntries(catalogueFor().map((r) => [r.name, r.section]));
  assert.equal(all['Mathematics'], null); assert.equal(all['Pre-Technical Studies'], 'JUNIOR'); assert.equal(all['Biology'], 'SENIOR');
});
test('names are unique, so a school can hold the whole list', () => {
  const n = CATALOGUE.map((r) => r.name); assert.equal(new Set(n).size, n.length);
});
test('class names map to the right band', () => {
  assert.equal(bandFor('PP1 RED'), 'PP'); assert.equal(bandFor('GRD 3 BLUE'), 'LOWER'); assert.equal(bandFor('GRADE 5 GREEN'), 'UPPER');
  assert.equal(bandFor('GRD 7 LOVE'), 'JUNIOR'); assert.equal(bandFor('Form 3 West'), '844'); assert.equal(bandFor('4 EAST'), '844'); assert.equal(bandFor('Grade 10'), 'CBC');
});
test('codes show for the senior section only', () => {
  assert.equal(codeFor('121', 'SENIOR'), '121'); assert.equal(codeFor('121', 'PRIMARY'), null); assert.equal(codeFor('121', 'JUNIOR'), null);
  assert.deepEqual(SECTION_KEYS, ['PRIMARY', 'JUNIOR', 'SENIOR']);
});
