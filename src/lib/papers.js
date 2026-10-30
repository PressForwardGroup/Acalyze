// English and Kiswahili are sat as several papers, and the NUMBERING CHANGES between sections:
//
//                      Junior (KJSEA, Grade 9)            Senior 8-4-4 (KCSE)
//   English  Paper 1   Language (multiple choice)  50      Functional writing, cloze, oral skills  60
//            Paper 2   Composition & literary analysis 50  Comprehension, literary appreciation, grammar 80
//            Paper 3   -                                    Creative composition & set-text essays 60
//   Kiswahili Paper 1  Lugha (multiple choice)      50      Insha                                   40
//            Paper 2   Insha na utangulizi wa fasihi 50     Lugha                                   80
//            Paper 3   -                                    Fasihi                                  80
//
// So "Composition" is English Paper 2 in junior but Paper 3 in senior, and "Insha" is Kiswahili Paper 2 in junior
// but Paper 1 in senior. Everything below is keyed by BAND (see curriculum.js bandFor), never by the paper number alone.
//
// Sources: KNEC KJSEA structure and timetable (papers 901/1, 901/2, 902/1, 902/2), KNEC KCSE papers 101/1-3 and 102/1-3.
// `confirmed: false` marks a maximum that is the standard figure but was not seen on a KNEC document;
// schools can set their own maximum per exam, and primary / Grade 10+ papers are set by the school, so they are not listed here.
import { normaliseKey } from './subjectResolver.js';

const S = (name, max, aliases = []) => ({ name, max, aliases });
const P = (no, name, max, code, aliases, sections = [], confirmed = true) => ({ no, name, max, code, aliases, sections, confirmed });

export const PAPERS = {
  English: {
    JUNIOR: [
      P(1, 'Language', 50, '901/1', ['PAPER 1', 'ENG 1', 'ENG1', 'ENGLISH 1', 'ENG PP1', 'LANGUAGE', 'ENGLISH LANGUAGE'],
        [S('Grammar', null, ['GRAMMAR']), S('Comprehension', null, ['COMPREHENSION', 'READING COMPREHENSION', 'READING']), S('Oral skills', null, ['ORAL SKILLS'])]),
      P(2, 'Composition & Literary Analysis', 50, '901/2', ['PAPER 2', 'ENG 2', 'ENG2', 'ENGLISH 2', 'ENG PP2', 'LITERARY ANALYSIS'],
        [S('Composition', 15, ['COMPOSITION', 'IMAGINATIVE COMPOSITION', 'WRITING']), S('Oral narrative', 10, ['ORAL NARRATIVE', 'ORAL LITERATURE']), S('Poetry', 5, ['POETRY']), S('Novella', 10, ['NOVELLA']), S('Play', 10, ['PLAY', 'DRAMA'])]),
    ],
    844: [
      P(1, 'Functional Writing, Cloze & Oral Skills', 60, '101/1', ['PAPER 1', 'ENG 1', 'ENG1', 'ENGLISH 1'],
        [S('Functional writing', 20, ['FUNCTIONAL WRITING']), S('Cloze test', 10, ['CLOZE', 'CLOZE TEST']), S('Oral skills', 30, ['ORAL SKILLS', 'ORAL'])]),
      P(2, 'Comprehension, Literary Appreciation & Grammar', 80, '101/2', ['PAPER 2', 'ENG 2', 'ENG2', 'ENGLISH 2'],
        [S('Comprehension', 20, ['COMPREHENSION']), S('Literary appreciation', 25, ['LITERARY APPRECIATION', 'EXCERPT']), S('Oral literature', 20, ['ORAL LITERATURE', 'ORAL NARRATIVE']), S('Grammar', 15, ['GRAMMAR'])]),
      P(3, 'Creative Composition & Set Texts', 60, '101/3', ['PAPER 3', 'ENG 3', 'ENG3', 'ENGLISH 3'],
        [S('Composition', 20, ['COMPOSITION', 'CREATIVE COMPOSITION', 'IMAGINATIVE WRITING']), S('Set texts', 40, ['SET TEXTS', 'SET BOOKS'])], false),
    ],
  },
  Kiswahili: {
    JUNIOR: [
      P(1, 'Lugha', 50, '902/1', ['KARATASI 1', 'KIS 1', 'KIS1', 'KISWAHILI 1', 'LUGHA', 'PAPER 1'], [], false),
      P(2, 'Insha na Utangulizi wa Fasihi', 50, '902/2', ['KARATASI 2', 'KIS 2', 'KIS2', 'KISWAHILI 2', 'INSHA', 'INSHA NA FASIHI', 'PAPER 2'],
        [S('Insha', 15, ['INSHA']), S('Fasihi simulizi', 10, ['FASIHI SIMULIZI']), S('Novela', 10, ['NOVELA']), S('Tamthilia', 10, ['TAMTHILIA']), S('Ushairi', 5, ['USHAIRI'])]),
    ],
    844: [
      P(1, 'Insha', 40, '102/1', ['KARATASI 1', 'KIS 1', 'KIS1', 'KISWAHILI 1', 'INSHA', 'PAPER 1']),
      P(2, 'Lugha', 80, '102/2', ['KARATASI 2', 'KIS 2', 'KIS2', 'KISWAHILI 2', 'LUGHA', 'PAPER 2'], [], false),
      P(3, 'Fasihi', 80, '102/3', ['KARATASI 3', 'KIS 3', 'KIS3', 'KISWAHILI 3', 'FASIHI', 'PAPER 3']),
    ],
  },
};

export const papersFor = (subject, band) => PAPERS[subject]?.[band] || null;

// Which paper (and section) is this header, for this subject in this band? null when it is not one of them.
export function resolvePart(subject, header, band) {
  const papers = papersFor(subject, band); const key = normaliseKey(header);
  if (!papers || !key) return null;
  for (const paper of papers) if (paper.aliases.some((a) => normaliseKey(a) === key)) return { paper, section: null };
  for (const paper of papers) for (const section of paper.sections) if (section.aliases.some((a) => normaliseKey(a) === key)) return { paper, section };
  return null;
}

// The subject's percentage from its papers: marks = { 1: 37, 2: 33 } (paper number -> marks). Papers not sat are left out,
// so the percentage is over the papers that were actually marked. Returns null when a paper has no maximum yet.
export function subjectPercent(subject, band, marks) {
  const papers = papersFor(subject, band); if (!papers) return null;
  let got = 0, out = 0;
  for (const [no, m] of Object.entries(marks)) {
    const p = papers.find((x) => x.no === Number(no)); if (!p || p.max == null || m == null || m === '') return null;
    got += Number(m); out += p.max;
  }
  return out ? { percent: Math.round((got / out) * 10000) / 100, outOf: out } : null;
}
