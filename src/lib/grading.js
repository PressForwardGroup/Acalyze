// Acalyze grading engine — handles BOTH CBC and 8-4-4, with the subject
// eligibility ("W, no results") rules and scale-detection logic validated
// against real school data in the Gradebook Analyzer prototype. Ported here
// so the backend computes the same numbers that prototype already proved
// correct, instead of MOHI's original CBC-only version.

export const CBC_LEVELS = ['BE2', 'BE1', 'AE2', 'AE1', 'ME2', 'ME1', 'EE2', 'EE1']; // index 0..7 -> points 1..8
export const F844_LEVELS = ['E', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A']; // index 0..11 -> points 1..12

// Percent lower-bound at each index (ascending). gradeIndex() finds the
// highest index whose bound the percent clears.
const BOUNDS_CBC = [0, 11, 21, 31, 41, 58, 75, 90];
const BOUNDS_844_SCIENCE_SENIOR = [0, 20.5, 28.5, 34.5, 39.5, 44.5, 49.5, 54.5, 59.5, 64.5, 69.5, 74.5]; // Form 3/4 sciences
const BOUNDS_844_OTHER = [0, 28.5, 34.5, 39.5, 44.5, 49.5, 54.5, 59.5, 64.5, 69.5, 74.5, 79.5];          // Form 3/4 non-science, and all Form 1/2
const BOUNDS_844_SCIENCE_JUNIOR = [0, 24.5, 28.5, 34.5, 39.5, 44.5, 49.5, 54.5, 59.5, 64.5, 69.5, 74.5]; // Form 1/2 sciences

const REMARK_CBC = ['WARNING', 'WAKE UP', 'B. AVERAGE', 'AVERAGE', 'GOOD', 'V.GOOD', 'EXCELLENT', 'EXCELLENT'];
const REMARK_844 = ['WARNING', 'WAKE UP', 'WAKE UP', 'WAKE UP', 'AVERAGE', 'AVERAGE', 'AVERAGE', 'FAIR', 'GOOD', 'GOOD', 'V.GOOD', 'EXCELLENT'];

function boundsFor(scheme, isScience, formLevel) {
  if (scheme === 'cbc') return BOUNDS_CBC;
  if (!isScience) return BOUNDS_844_OTHER;
  return Number(formLevel) <= 2 ? BOUNDS_844_SCIENCE_JUNIOR : BOUNDS_844_SCIENCE_SENIOR;
}

function levelsFor(scheme) {
  return scheme === 'cbc' ? CBC_LEVELS : F844_LEVELS;
}

// percent -> { grade, points, index }
export function gradeFor(scheme, percent, { isScience = false, formLevel = null } = {}) {
  const bounds = boundsFor(scheme, isScience, formLevel);
  const levels = levelsFor(scheme);
  const pct = Math.max(0, Math.min(100, Number(percent)));
  let idx = 0;
  bounds.forEach((b, i) => { if (pct >= b) idx = i; });
  return { grade: levels[idx], points: idx + 1, index: idx };
}

// A typed level (ME1, B+) has no mark, but the mean and ranking need one. Use the middle of the level's real KNEC range
// (ME1 = 58-74% -> 66%), and slide smoothly between levels for averaged points. This replaces points / top * 100, which called ME1 75%.
function bandMids(bounds, integerBands) {
  return bounds.map((lo, i) => {
    const hi = i + 1 < bounds.length ? (integerBands ? bounds[i + 1] - 1 : bounds[i + 1]) : 100;
    return ((i === 0 && integerBands ? 1 : lo) + hi) / 2;
  });
}
const MIDS_CBC = bandMids(BOUNDS_CBC, true);
const MIDS_844 = bandMids(BOUNDS_844_OTHER, false);
export function pointsToPercent(scheme, points) {
  if (points == null || Number.isNaN(Number(points))) return null;
  const mids = scheme === 'cbc' ? MIDS_CBC : MIDS_844;
  const f = Math.min(Math.max(Number(points) - 1, 0), mids.length - 1);
  const i = Math.min(Math.floor(f), mids.length - 2);
  return Math.round((mids[i] + (mids[i + 1] - mids[i]) * (f - i)) * 100) / 100;
}

export function isValidGrade(scheme, grade) {
  return levelsFor(scheme).includes(grade);
}

export function remarkFor(scheme, index) {
  const table = scheme === 'cbc' ? REMARK_CBC : REMARK_844;
  return table[Math.max(0, Math.min(table.length - 1, index))];
}

// Mirrors MOHI's original single-number summary (kept for anywhere that
// still wants a coarse CBC band from a mean points value).
export function pointsToLevel(points) {
  const rounded = Math.max(1, Math.min(8, Math.round(points)));
  if (rounded >= 7) return 'EE';
  if (rounded >= 5) return 'ME';
  if (rounded >= 3) return 'AE';
  return 'BE';
}

// Scale detection: given the raw marks entered for one subject across a
// class, guess what they were marked "out of" (10/20/25/.../100), the same
// heuristic validated against the real Form 3 Maths data (median 3, max 47
// correctly flagged as "likely out of 50", not 100).
const OUT_OF_STEPS = [10, 20, 25, 30, 40, 50, 60, 70, 80, 100];
export function suggestOutOf(rawValues) {
  const max = Math.max(0, ...rawValues.filter((v) => v != null));
  return OUT_OF_STEPS.find((o) => o >= max) || 100;
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// Flags a subject's raw marks as suspicious (likely wrong "out of" value or
// a placeholder/typo'd scale) — same thresholds proven against the real
// Form 3 Maths data in the prototype.
export function scaleCheck(rawValues) {
  const v = rawValues.filter((x) => x != null);
  if (v.length < 5) return { suspicious: false };
  const max = Math.max(...v);
  const med = median(v);
  const lowShare = v.filter((x) => x <= 10).length / v.length;
  const counts = {};
  v.forEach((x) => { counts[x] = (counts[x] || 0) + 1; });
  const topCount = Math.max(...Object.values(counts));
  const repeatedShare = topCount / v.length;
  const suspicious = med < 15 || lowShare > 0.5 || repeatedShare >= 0.5;
  return { suspicious, median: med, max, lowShare, repeatedShare, suggestedOutOf: suggestOutOf(v) };
}

// Subject classifiers. A subject is identified by its NAME ("Mathematics")
// and/or its report-form CODE ("121"), so each check looks at both and
// tolerates variants like "Core Mathematics" or "Kiswahili/Fasihi".
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const labelsOf = (x) => (typeof x === 'object' && x !== null ? [x.code, x.name] : [x]).map(norm).filter(Boolean);
const anyMatch = (x, re) => labelsOf(x).some((l) => re.test(l));

export const isMathSubject = (x) => anyMatch(x, /^MAT(H|HS|HEMATICS)?$|MATH|^COREMAT|^ESTMAT|^ESSMAT/);
export const isEnglishSubject = (x) => anyMatch(x, /^ENG/);
export const isKiswahiliSubject = (x) => anyMatch(x, /^KIS/);
export const isCslSubject = (x) => anyMatch(x, /^CSL|COMMUNITYSERVICE/);
export const isScienceSubject = (x) => isMathSubject(x) || anyMatch(x, /^(BIO|PHY|CHEM)/);

// Computes one student's full result for one exam.
// marks: [{ subjectId, name, code, isScience, percent }], percent already
// converted via the "out of" scale (so always 0-100).
// scheme: 'cbc' | '844'; formLevel: number (1-4 for 844, grade number for cbc, used for junior-science boundary only).
export function computeStudentResult({ scheme, marks, formLevel = null }) {
  // A mark may arrive as a percentage (graded here) or, for CBC teachers who
  // enter a level directly, as a stored grade + points with no percentage.
  const graded = marks
    .filter((m) => m.percent != null || (m.grade && m.points != null))
    .map((m) => (m.percent != null
      ? { ...m, ...gradeFor(scheme, m.percent, { isScience: m.isScience, formLevel }) }
      : { ...m, index: m.points - 1 }));

  const n = graded.length;
  let eligible = true;
  let reason = null;
  let counted = graded;

  if (scheme === '844') {
    const hasMath = graded.some((m) => isMathSubject(m));
    if (!hasMath) {
      eligible = false;
      reason = 'missing compulsory Mathematics';
    } else if (n < 7) {
      eligible = false;
      reason = `${n} subjects done (needs at least 7: Mathematics + 6 others)`;
    } else if (n > 7) {
      // Mathematics is compulsory; the other 6 counted are the best-scoring
      // of the remaining subjects by points then percent.
      const mathMark = graded.find((m) => isMathSubject(m));
      const rest = graded
        .filter((m) => m !== mathMark)
        .sort((a, b) => b.points - a.points || b.percent - a.percent)
        .slice(0, 6);
      const keepIds = new Set([mathMark.subjectId, ...rest.map((m) => m.subjectId)]);
      counted = graded.map((m) => ({ ...m, isCounted: keepIds.has(m.subjectId) }));
    }
  } else {
    // CBC: 4 compulsory (Maths/Core Maths, Kiswahili, English, CSL) + 3
    // selective = exactly 7 subjects sat.
    const need = [
      { test: isMathSubject, label: 'Maths' },
      { test: isKiswahiliSubject, label: 'Kiswahili' },
      { test: isEnglishSubject, label: 'English' },
      { test: isCslSubject, label: 'CSL' },
    ];
    const missing = need.filter((req) => !graded.some((m) => req.test(m))).map((r) => r.label);
    if (missing.length) {
      eligible = false;
      reason = `missing compulsory ${missing.join(', ')}`;
    } else if (n !== 7) {
      eligible = false;
      reason = `${n} subjects done (must be exactly 7: 4 compulsory + 3 selective)`;
    }
  }

  counted = counted.map((m) => ({ ...m, isCounted: m.isCounted ?? true }));
  if (!eligible) {
    return { eligible, reason, marks: counted.map((m) => ({ ...m, isCounted: false })), total: null, mean: null, totalPoints: null, meanPoints: null, grade: null };
  }

  const used = counted.filter((m) => m.isCounted);
  const withPct = used.filter((m) => m.percent != null);
  const total = withPct.reduce((a, m) => a + m.percent, 0);
  const totalPoints = used.reduce((a, m) => a + m.points, 0);
  const mean = withPct.length ? total / withPct.length : null;   // null if every mark was a direct level
  const meanPoints = used.length ? totalPoints / used.length : null;
  const levels = levelsFor(scheme);
  const overall = meanPoints != null ? levels[Math.max(0, Math.min(levels.length - 1, Math.round(meanPoints) - 1))] : null;

  return {
    eligible: true,
    reason: null,
    marks: counted,
    total,
    mean,
    totalPoints,
    meanPoints,
    grade: overall,
    remark: meanPoints != null ? remarkFor(scheme, Math.round(meanPoints) - 1) : null,
  };
}
