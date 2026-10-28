// The official subject lists, one catalogue for every section a school can use.
//
// Sources (checked 26 Oct 2026):
//   - KNEC KCSE subject codes (8-4-4, Forms 1-4): 31 subjects, codes 101-565.
//   - KICD / Ministry of Education rationalised learning areas:
//       PP1-PP2 (5), Grade 1-3 (7), Grade 4-6 (8), Grade 7-9 (9 = the nine KJSEA learning areas),
//       Grade 10-12 (4 compulsory + 3 electives; Core or Essential Mathematics).
//   - Physical Education and ICT at Grade 10+ are school-assessed, outside the 7 examined subjects.
//
// Subject CODES belong to the SENIOR section only (KNEC KCSE codes for 8-4-4). Primary and junior subjects have none.
// Subjects that exist only in Grade 10-12 (CBC) are seeded without a code until KNEC's codes are confirmed;
// codeFor() is the one place that decides whether a code is shown.

export const SECTION_KEYS = ['PRIMARY', 'JUNIOR', 'SENIOR'];
export const SECTION_LABELS = {
  PRIMARY: 'Primary (PP1 to Grade 6)',
  JUNIOR: 'Junior school (Grade 7 to 9)',
  SENIOR: 'Senior school (Form 1-4 and Grade 10-12)',
};

// bands: PP (PP1-2), LOWER (Gr 1-3), UPPER (Gr 4-6), JUNIOR (Gr 7-9), 844 (Forms), CBC (Gr 10-12)
export const BAND_SECTION = { PP: 'PRIMARY', LOWER: 'PRIMARY', UPPER: 'PRIMARY', JUNIOR: 'JUNIOR', 844: 'SENIOR', CBC: 'SENIOR' };
export const bandsOfSection = (s) => Object.keys(BAND_SECTION).filter((b) => BAND_SECTION[b] === s);

// Which band a class belongs to, from its name or grade ("PP1", "Grade 5", "GRD 7 LOVE", "Form 3", "Grade 10").
export function bandFor(label) {
  const t = String(label ?? '').toUpperCase();
  if (/\bPP\s*[12]\b|^PP/.test(t)) return 'PP';
  if (/\bFORM\s*[1-4]\b|\bF\s*[1-4]\b/.test(t)) return '844';
  if (/^\s*[1-4]\s+[A-Z]/.test(t) && !/GRADE|GRD/.test(t)) return '844';      // "4 EAST", "3 CENTRAL" are Form streams
  const n = Number((t.match(/(?:GRADE|GRD|GR|CLASS|STD|G)\s*0?(\d{1,2})\b/) || [])[1]);
  if (!n) return null;
  if (n <= 3) return 'LOWER';
  if (n <= 6) return 'UPPER';
  if (n <= 9) return 'JUNIOR';
  return 'CBC';
}
export const sectionOfBand = (b) => BAND_SECTION[b] || null;

const ALL = ['PP', 'LOWER', 'UPPER', 'JUNIOR', '844', 'CBC'];
const PRI = ['LOWER', 'UPPER'];
const rows = [];
// add(bands, name, short, aliases, extras) - extras: code (KCSE), science, parts, pathway, assessed
const add = (bands, name, short, aliases = [], extra = {}) => rows.push({ bands, name, short, aliases, ...extra });

// ---------- shared across sections ----------
add(['PP', 'LOWER', 'UPPER', 'JUNIOR', '844'], 'Mathematics', 'MAT', ['MATHS', 'MATH', 'MAT', 'MATHEMATICAL ACTIVITIES'], { code: '121', science: true });
add(['LOWER', 'UPPER', 'JUNIOR', '844', 'CBC'], 'English', 'ENG', ['ENGLISH', 'ENGLISH LANGUAGE'], {
  code: '101',
  parts: ['GRAMMAR', 'COMPREHENSION', 'COMP', 'READING', 'WRITING', 'COMPOSITION', 'ENG 1', 'ENG 2', 'ENGLISH 1', 'ENGLISH 2', 'ENG PP1', 'ENG PP2', 'PAPER 1', 'PAPER 2'],
  partBands: ['LOWER', 'UPPER', 'JUNIOR'] });
add(['LOWER', 'UPPER', 'JUNIOR', '844', 'CBC'], 'Kiswahili', 'KIS', ['KISW', 'KISWAHILI', 'KISWAHILI KSL'], {
  code: '102',
  parts: ['LUGHA', 'KUSOMA', 'INSHA', 'KARATASI 1', 'KARATASI 2', 'KISWAHILI 1', 'KISWAHILI 2', 'KIS 1', 'KIS 2'],
  partBands: ['LOWER', 'UPPER', 'JUNIOR'], extraAliasBands: { JUMLA: ['JUNIOR'] } });
add(['PP', 'LOWER', 'UPPER', 'JUNIOR'], 'Religious Education', 'RE', ['RELIGIOUS', 'RELIGIOUS EDUCATION', 'RELIGIOUS ACTIVITIES', 'RELIGIOUS INSTRUCTION', 'RELIGION', 'RE', 'CRE', 'CRE IRE HRE']);

// ---------- PRIMARY ----------
add(['PP'], 'Language Activities', 'LANG', ['LANGUAGE', 'LANG', 'LANGUAGE ACTIVITIES']);
add(['LOWER', 'CBC'], 'Indigenous Language', 'IL', ['INDIGENOUS LANGUAGE', 'INDIGENOUS', 'MOTHER TONGUE', 'IL']);
add(['PP', 'LOWER'], 'Environmental Activities', 'ENV', ['ENVIRONMENTAL', 'ENVIRONMENTAL ACTIVITIES', 'ENV', 'ENVIRONMENT']);
add(['PP', 'LOWER'], 'Creative Activities', 'CREATIVE', ['CREATIVE', 'CREATIVE ACTIVITIES', 'CREATIVE ARTS', 'C/A']);
add(['UPPER'], 'Creative Arts', 'C/A', ['CREATIVE ARTS', 'CREATIVE', 'C/A', 'CA']);
add(['UPPER'], 'Science and Technology', 'SCI&TECH', ['SCIE&TECH', 'SCIE&TECNO', 'SCIE&TECHNO', 'SCI&TECH', 'SCIENCE & TECH', 'SCIENCE AND TECHNOLOGY', 'SCI TECH', 'SCIENCE']);
add(['UPPER', 'JUNIOR'], 'Agriculture and Nutrition', 'AGRI&NUT', ['AGRI&NUT', 'AGRI/NUT', 'AGRIC&NUT', 'AGRIC &NUT', 'AGRICULTURE AND NUTRITION', 'AGRI']);
add(['UPPER', 'JUNIOR'], 'Social Studies', 'SST', ['SST', 'SOCIAL', 'SOCIAL STUDIES', 'SOC STUDIES']);

// ---------- JUNIOR (the nine KJSEA learning areas) ----------
add(['JUNIOR'], 'Integrated Science', 'INT SCI', ['INTEGRATED SCIENCE', 'INTER SCIENCE', 'INT SCIENCE', 'INT SCI', 'INTERGRATED SCIENCE', 'SCIENCE']);
add(['JUNIOR'], 'Pre-Technical Studies', 'PRE-TECH', ['PRE-TECH', 'PRETECH', 'PRE TECH', 'PRE-TECHNICAL', 'PRE TECHNICAL STUDIES']);
add(['JUNIOR'], 'Creative Arts and Sports', 'CAS', ['CAS', 'CREATIVE ARTS AND SPORTS', 'CREATIVE ARTS & SPORTS']);

// ---------- SENIOR, 8-4-4 (KNEC KCSE codes) ----------
const k = (code, name, short, aliases, extra = {}) => add(['844'], name, short, aliases, { code, ...extra });
k('122', 'Mathematics Alternative B', 'MAT B', ['MAT B', 'MATHS B', 'MATHEMATICS ALTERNATIVE B'], { science: true });
k('231', 'Biology', 'BIO', ['BIO', 'BIOLOGY'], { science: true });
k('232', 'Physics', 'PHY', ['PHY', 'PHYSICS'], { science: true });
k('233', 'Chemistry', 'CHEM', ['CHEM', 'CHEMISTRY'], { science: true });
k('236', 'Biology for the Blind', 'BIO-B', ['BIOLOGY FOR THE BLIND'], { science: true });
k('237', 'General Science', 'GEN SCI', ['GEN SCI', 'GENERAL SCIENCE']);
k('311', 'History and Government', 'HIS', ['HIS', 'HAG', 'HIST', 'HISTORY', 'HISTORY & GOVERNMENT', 'H&G']);
k('312', 'Geography', 'GEO', ['GEO', 'GEOG', 'GEOGRAPHY']);
k('313', 'Christian Religious Education', 'CRE', ['CRE', 'C.R.E', 'CHRISTIAN RELIGIOUS EDUCATION']);
k('314', 'Islamic Religious Education', 'IRE', ['IRE', 'ISLAMIC RELIGIOUS EDUCATION']);
k('315', 'Hindu Religious Education', 'HRE', ['HRE', 'HINDU RELIGIOUS EDUCATION']);
k('441', 'Home Science', 'HSC', ['HSC', 'HOME SCI', 'HOME SCIENCE', 'HOMESCIENCE']);
k('442', 'Art and Design', 'ART', ['ART', 'A&D', 'ART & DESIGN']);
k('443', 'Agriculture', 'AGR', ['AGR', 'AGRI', 'AGRIC', 'AGRICULTURE']);
k('444', 'Woodwork', 'WOOD', ['WOOD', 'WOODWORK', 'WOOD WORK']);
k('445', 'Metalwork', 'METAL', ['METAL', 'METALWORK', 'METAL WORK']);
k('446', 'Building Construction', 'BC', ['BC', 'B/C', 'BUILDING', 'BUILDING CONSTRUCTION']);
k('447', 'Power Mechanics', 'P/MECH', ['PM', 'P/MECS', 'P/MECH', 'POWER MECHANICS']);
k('448', 'Electricity', 'ELEC', ['ELEC', 'ELECTRICITY']);
k('449', 'Drawing and Design', 'D&D', ['DD', 'D&D', 'DRAWING & DESIGN', 'DRAWING AND DESIGN']);
k('450', 'Aviation Technology', 'AVIA', ['AVIA', 'AVIATION', 'AVIATION TECHNOLOGY']);
k('451', 'Computer Studies', 'COMP', ['COMP', 'COM', 'COMPUTER', 'COMPUTERS', 'COMPUTER STUDIES']);
k('501', 'French', 'FRE', ['FRE', 'FRENCH']);
k('502', 'German', 'GER', ['GER', 'GERMAN']);
k('503', 'Arabic', 'ARA', ['ARA', 'ARABIC']);
k('504', 'Kenya Sign Language', 'KSL', ['KSL', 'SIGN LANGUAGE', 'KENYA SIGN LANGUAGE']);
k('511', 'Music', 'MUS', ['MUS', 'MUSIC']);
k('565', 'Business Studies', 'BST', ['BST', 'BUS', 'BUSINESS', 'BUSINESS STUDIES']);

// ---------- SENIOR, CBC Grade 10-12 (KICD) ----------
const g = (name, short, aliases, pathway, extra = {}) => add(['CBC'], name, short, aliases, { pathway, ...extra });
g('Core Mathematics', 'CORE MAT', ['CORE MAT', 'COREMAT', 'CORE MATHS', 'CORE MATHEMATICS'], 'CORE', { science: true });
g('Essential Mathematics', 'EST MATHS', ['EST MATHS', 'ESTMATHS', 'ESSENTIAL MATHS', 'ESS MATHS', 'ESSENTIAL MATHEMATICS'], 'CORE', { science: true });
g('Community Service Learning', 'CSL', ['CSL', 'COMMUNITY SERVICE LEARNING'], 'CORE');
g('Physical Education', 'PE', ['PE', 'P.E', 'PHYSICAL EDUCATION'], 'ARTS_SPORTS', { assessed: 'school' });
g('Advanced Mathematics', 'ADV MAT', ['ADV MATHS', 'ADVANCED MATHEMATICS'], 'STEM', { science: true });
g('Electrical Technology', 'ELEC TECH', ['ELECTRICAL TECHNOLOGY'], 'STEM');
g('Metal Technology', 'METAL TECH', ['METAL TECHNOLOGY'], 'STEM');
g('Wood Technology', 'WOOD TECH', ['WOOD TECHNOLOGY'], 'STEM');
g('Media Technology', 'MEDIA TECH', ['MEDIA TECHNOLOGY'], 'STEM');
g('Marine and Fisheries Technology', 'MARINE', ['MARINE AND FISHERIES TECHNOLOGY'], 'STEM');
g('Advanced English', 'ADV ENG', ['ADVANCED ENGLISH'], 'SOCIAL');
g('Literature in English', 'LIT', ['LIT', 'LITERATURE', 'LITERATURE IN ENGLISH'], 'SOCIAL');
g('Kiswahili Kipevu', 'KIS KIPEVU', ['KISWAHILI KIPEVU', 'KIPEVU'], 'SOCIAL');
g('Fasihi ya Kiswahili', 'FASIHI', ['FASIHI', 'FASIHI YA KISWAHILI'], 'SOCIAL');
g('Mandarin Chinese', 'MANDARIN', ['MANDARIN', 'CHINESE', 'MANDARIN CHINESE'], 'SOCIAL');
g('History and Citizenship', 'HIS', ['HIS', 'HAG', 'HIST', 'HISTORY', 'HISTORY AND CITIZENSHIP'], 'SOCIAL');
g('Sports and Recreation', 'SPR', ['SPR', 'SPORTS AND RECREATION'], 'ARTS_SPORTS');
g('Music and Dance', 'MUS & DANCE', ['MUSIC AND DANCE'], 'ARTS_SPORTS');
g('Theatre and Film', 'THEATRE', ['THEATRE AND FILM', 'THEATRE'], 'ARTS_SPORTS');
g('Fine Arts', 'FINE ARTS', ['FINE ARTS', 'FA'], 'ARTS_SPORTS');
// CBC shares these by name with the 8-4-4 list (same row, wider bands)
for (const n of ['Biology', 'Physics', 'Chemistry', 'General Science', 'Agriculture', 'Computer Studies', 'Home Science', 'Geography',
  'Christian Religious Education', 'Islamic Religious Education', 'Hindu Religious Education', 'Business Studies', 'French', 'German', 'Arabic', 'Drawing and Design',
  'Aviation Technology', 'Power Mechanics', 'Kenya Sign Language', 'Music'])
  rows.find((r) => r.name === n && r.bands.includes('844')).bands.push('CBC');

export const CATALOGUE = rows;

// Subject rows ready to insert for the sections a school uses: one row per subject name, with
// section = the one section it belongs to, or null when it is shared by several.
export function catalogueFor(sections = SECTION_KEYS) {
  const want = new Set(sections);
  const out = [];
  for (const r of CATALOGUE) {
    const bands = r.bands.filter((b) => want.has(BAND_SECTION[b]));
    if (!bands.length) continue;
    const secs = [...new Set(bands.map((b) => BAND_SECTION[b]))];
    out.push({
      name: r.name, short: r.short, aliases: r.aliases, parts: r.parts || [], partBands: r.partBands || [], extraAliasBands: r.extraAliasBands || {},
      bands, section: secs.length === 1 ? secs[0] : null,
      code: bands.includes('844') ? r.code || null : null,           // KCSE codes: 8-4-4 senior only
      isScience: !!r.science, pathway: r.pathway || null, assessed: r.assessed || null,
    });
  }
  return out;
}

// The one place that decides whether a subject code is shown: only for 8-4-4 senior classes.
export function codeFor(code, classBandOrSection) {
  if (!code) return null;
  return ['SENIOR', '844', 'CBC'].includes(classBandOrSection) ? code : null;
}
