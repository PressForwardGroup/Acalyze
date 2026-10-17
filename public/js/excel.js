// Reads a school's marks-entry workbook (one sheet per class: "FORM 3", "FORM 4",
// "GRADE 10"...) into plain objects. Pure: takes rows (arrays of arrays, as
// SheetJS's sheet_to_json({header:1}) gives) so it can be tested without a
// browser or the spreadsheet library. Layouts handled:
//   - subject names on the same row as "STUDENT NAME" (Form 3),
//   - subject names one row above it (Form 4),
//   - no "STUDENT NAME" header at all, data starting under the subject row (Grade 10).

const FULL_NAMES = {
  ENG: 'English', KIS: 'Kiswahili', MAT: 'Mathematics', BIO: 'Biology', PHY: 'Physics', CHEM: 'Chemistry', CHE: 'Chemistry',
  HAG: 'History & Government', HIS: 'History & Government', GEO: 'Geography', CRE: 'CRE', AGR: 'Agriculture', AGRI: 'Agriculture',
  COMP: 'Computer Studies', COM: 'Computer Studies', BUS: 'Business Studies', BST: 'Business Studies', LIT: 'Literature in English',
  FASIHI: 'Fasihi', 'CORE MAT': 'Core Mathematics', 'EST MATHS': 'Essential Mathematics', 'ESS MAT': 'Essential Mathematics',
  CSL: 'Community Service Learning', BAC: 'Biology (BAC)', ELC: 'ELC', SPR: 'SPR',
};
export const subjectName = (key) => FULL_NAMES[key] || key.charAt(0) + key.slice(1).toLowerCase();

const T = (rows, r) => (rows[r] || []).map((c) => String(c ?? '').trim().toUpperCase());
const STOP = /SUBJ|ENTRY|KCPE|MARKS|KJSEA|STRM|STREAM|HOME/;
const SKIP = /^(ASS NO|PATHWAY|P\/MECS)$/;
const OUT_OF_STEPS = [10, 20, 25, 30, 40, 50, 60, 70, 80, 100];
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// "FORM 3" -> { kind:'form', number:3, grade:'Form 3', scheme:'844', section:'SENIOR' }
export function levelOf(sheetName) {
  const m = String(sheetName).match(/\b(FORM|GRADE)\s*(\d{1,2})\b/i);
  if (!m) return null;
  const kind = m[1].toLowerCase(), number = +m[2];
  const section = kind === 'form' ? 'SENIOR' : number <= 6 ? 'PRIMARY' : number <= 9 ? 'JUNIOR' : 'SENIOR';
  return { kind, number, grade: `${titleCase(kind)} ${number}`, scheme: kind === 'form' ? '844' : 'cbc', section };
}

// Stream labels in the sheets are messy ("3 NORTH EAST", "NORTHWEST" vs "NORTH WEST",
// "4 SOUTH WEST" typed into a Form 3 sheet). Normalise: drop the leading form number,
// treat spacing variants as one stream, and show the most common (spaced) spelling.
function canonicalStreams(rawList) {
  const bucket = new Map();
  for (const raw of rawList) {
    const label = String(raw || '').trim().replace(/^\d+\s*/, '').replace(/\s+/g, ' ');
    if (!label) continue;
    const key = label.toUpperCase().replace(/\s/g, '');
    const b = bucket.get(key) || { variants: new Map() };
    b.variants.set(label.toUpperCase(), (b.variants.get(label.toUpperCase()) || 0) + 1);
    bucket.set(key, b);
  }
  const display = new Map();
  for (const [key, b] of bucket) {
    const best = [...b.variants.entries()].sort((a, c) => (c[0].includes(' ') - a[0].includes(' ')) || c[1] - a[1])[0][0];
    display.set(key, titleCase(best));
  }
  return (raw) => {
    const label = String(raw || '').trim().replace(/^\d+\s*/, '').replace(/\s+/g, ' ');
    return label ? display.get(label.toUpperCase().replace(/\s/g, '')) : null;
  };
}

export function parseSheet(rows, name) {
  const level = levelOf(name);
  let sr = -1;
  for (let r = 0; r < Math.min(rows.length, 10); r++) { const t = T(rows, r); if (t.includes('ENG') && t.includes('KIS')) { sr = r; break; } }
  if (sr < 0) return { name, skipped: 'No subject headers (ENG, KIS...) found, so this does not look like a marks sheet.' };
  if (!level) return { name, skipped: `Can't tell the class level from the sheet name "${name}". Name it like "FORM 3" or "GRADE 10".` };

  let hr = -1;
  for (let r = 0; r <= sr + 1 && r < rows.length; r++) if (T(rows, r).includes('STUDENT NAME')) hr = r;
  const st = Math.max(sr, hr) + 1, SR = T(rows, sr);
  const hs = [st - 3, st - 2, st - 1].filter((r) => r >= 0);
  const W = Math.max(...hs.map((r) => (rows[r] || []).length));
  const CT = Array.from({ length: W }, (_, j) => hs.map((r) => T(rows, r)[j] || '').join(' '));

  const subs = [];
  for (let j = 3; j < W; j++) {
    if (STOP.test(CT[j])) break;
    const key = SR[j];
    if (key && !SKIP.test(key)) subs.push({ key, col: j, code: hs.map((r) => T(rows, r)[j]).find((x) => /^\d{3}$/.test(x || '')) || '' });
  }
  const ce = CT.findIndex((x, j) => j >= 3 && /KCPE/.test(x));          // KCPE marks (8-4-4 only; KJSEA is not a score we use)
  const cs = CT.findIndex((x, j) => j >= 3 && /STRM|STREAM/.test(x));

  const issues = [], students = [], seen = new Map();
  for (let r = st; r < rows.length; r++) {
    const R = rows[r], nm = R && R[1];
    if (typeof nm !== 'string' || !nm.trim() || /STUDENT NAME/i.test(nm)) continue;
    const adm = R[2] == null ? '' : String(R[2]).trim();
    const who = nm.trim();
    const marks = {};
    for (const { key, col } of subs) {
      let v = R[col];
      if (v == null || v === '') continue;
      if (typeof v === 'string') {
        const p = parseFloat(v);
        if (Number.isFinite(p)) issues.push(`${who}: ${key} "${v}" was read as ${p}`);
        else { issues.push(`${who}: ${key} "${v}" is not a number, so it was left out`); continue; }
        v = p;
      }
      if (typeof v === 'number' && Number.isFinite(v)) marks[key] = v;
    }
    const kc = ce >= 0 ? Number(R[ce]) : NaN;
    students.push({ name: who, adm, rawStream: cs >= 0 && R[cs] ? String(R[cs]) : '', kcpe: Number.isFinite(kc) && kc > 0 ? kc : null, marks, row: r + 1 });
  }
  const streamOf = canonicalStreams(students.map((s) => s.rawStream));
  // A stream typed as "4 SOUTH WEST" inside the Form 3 sheet is probably a mistake.
  const wrongLevel = students.filter((s) => { const d = String(s.rawStream).trim().match(/^(\d+)\b/); return d && +d[1] !== level.number && level.kind === 'form'; });
  if (wrongLevel.length) issues.push(`${wrongLevel.length} student(s) are listed under another form's stream (e.g. "${String(wrongLevel[0].rawStream).trim()}") in the ${level.grade} sheet. They will be imported into ${level.grade}`);
  for (const s of students) { s.stream = streamOf(s.rawStream); delete s.rawStream; }

  // Data problems an admin should know about before importing.
  const byAdm = new Map();
  for (const s of students) if (s.adm) (byAdm.get(s.adm.toLowerCase()) || byAdm.set(s.adm.toLowerCase(), []).get(s.adm.toLowerCase())).push(s);
  for (const [adm, list] of byAdm) if (list.length > 1) issues.push(`Admission number ${list[0].adm} is shared by ${list.map((x) => x.name).join(' and ')}. Only the first will be imported`);
  const noAdm = students.filter((s) => !s.adm).length;
  if (noAdm) issues.push(`${noAdm} student(s) have no admission number and will be skipped`);
  const noStream = students.filter((s) => !s.stream).length;
  if (noStream) issues.push(`${noStream} student(s) have no stream and will go into "${level.grade} (no stream)"`);

  // Per-subject scale check, same thresholds the Gradebook Analyzer proved on real data.
  const subjects = subs.map(({ key, code }) => {
    const v = students.map((s) => s.marks[key]).filter((x) => x != null);
    const max = v.length ? Math.max(...v) : 0, med = median(v);
    const top = v.length ? Math.max(...Object.values(v.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {}))) : 0;
    const lowShare = v.length ? v.filter((x) => x <= 10).length / v.length : 0;
    const reasons = [];
    if (v.length >= 5) {
      if (med < 15) reasons.push(`median is only ${Math.round(med * 10) / 10}`);
      if (lowShare > 0.5) reasons.push(`${Math.round(lowShare * 100)}% of marks are 10 or less`);
      if (top / v.length >= 0.5) reasons.push(`${Math.round((top / v.length) * 100)}% of marks are the same value`);
    }
    return { key, code, name: subjectName(key), entries: v.length, max, median: med, suggestedOutOf: OUT_OF_STEPS.find((o) => o >= max) || 100, suspicious: reasons.length > 0, reasons };
  });

  const streamCounts = {};
  for (const s of students) { const k = s.stream || '(none)'; streamCounts[k] = (streamCounts[k] || 0) + 1; }
  return { name, level, subjects, students, issues, streams: Object.entries(streamCounts).map(([stream, count]) => ({ stream, count })) };
}

export function parseWorkbook(sheets) {
  return Object.entries(sheets).map(([name, rows]) => parseSheet(rows, name))
    .filter((s) => !(s.skipped && /No subject headers/.test(s.skipped) && !/FORM|GRADE/i.test(s.name)));   // quietly ignore helper sheets
}
