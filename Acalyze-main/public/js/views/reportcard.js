import { esc, num, toast, barChart, lineChart, fmtDate } from '../ui.js';

// Report-card options a school edits once and reuses (term label, signatures, etc).
const SKEY = 'acalyze.cardOptions';
export function cardOptions() {
  let o = {}; try { o = JSON.parse(localStorage.getItem(SKEY)) || {}; } catch { /* fresh */ }
  return { term: '', date: todayStr(), nextTerm: '', character: 'Good', attendance: 'Regular', coCurricular: 'Active', classTeacher: '', principal: '', ...o };
}
export function saveCardOptions(o) { localStorage.setItem(SKEY, JSON.stringify(o)); }
export function todayStr() {
  const d = new Date(), m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${String(d.getDate()).padStart(2, '0')}-${m}-${String(d.getFullYear()).slice(2)}`;
}
export function termFromExam(exam) {
  const m = String(exam?.term || exam?.name || '').match(/(?:term\s*)?(III|II|I|[123])\b/i);
  const map = { I: 'ONE', 1: 'ONE', II: 'TWO', 2: 'TWO', III: 'THREE', 3: 'THREE' };
  return m ? `TERM ${map[m[1].toUpperCase()] || ''}`.trim() : '';
}

const principalNote = (s) => {
  if (!s.remark) return '';
  const t = s.remark.charAt(0) + s.remark.slice(1).toLowerCase();
  return `${t}${s.grade && s.meanPoints / s.topPoints >= 0.6 ? ', keep up' : ', work harder'}`;
};

// ---------- Classic: the printed Kenyan terminal report form ----------
export function classicCard(card, exam, o = cardOptions()) {
  const { school, student, lines, summary: s } = card;
  const label = card.scheme === 'cbc' ? 'GRADE' : 'FORM';
  const shown = card.scheme === 'cbc' ? lines.filter((l) => l.taken) : lines;      // CBC lists only subjects taken
  const W = !s.eligible;
  const term = o.term || termFromExam(exam);
  const rows = shown.map((l) => {
    const t = l.taken;
    return `<tr class="${t && l.isCounted === false ? 'xc' : ''}"><td>${esc(l.name)}</td><td>${esc(l.code || '')}</td>
      <td>${t && l.percent != null ? Math.round(l.percent) : t ? '—' : '—'}</td><td>${t ? esc(l.grade) : '—'}</td><td>${t ? l.points : '—'}</td>
      <td>${t ? l.position ?? '—' : '—'}</td><td>${t ? esc(l.remark || '') : '—'}</td><td></td></tr>`;
  }).join('');
  const excluded = lines.some((l) => l.taken && l.isCounted === false && s.eligible);
  return `<div class="rc">
  ${school.logoUrl ? `<img class="logo" src="${esc(school.logoUrl)}" alt="">` : ''}
  <h2>${esc(school.name)}</h2>${school.motto ? `<div class="mo">MOTTO: ${esc(school.motto)}</div>` : ''}
  <div class="ti">ACADEMIC PROGRESS TERMINAL REPORT FORM</div>
  <table>
   <tr><td><b>NAME: ${esc(student.name)}</b><br>ADM NO: ${esc(student.admissionNo)}</td><td class="big">${esc(term)}</td>
       <td>${label}: <b>${esc(student.className)}</b>${card.scheme === '844' ? `<br>KCPE MARKS: ${student.kcpeMarks || '—'}` : ''}</td>
       <td>DATE: ${esc(o.date)}<br>TOTAL POINTS: <b>${W ? 'W' : s.totalPoints}</b></td></tr>
   <tr><td>POSITION: <b>${W ? 'W' : s.position}</b> &nbsp; OUT OF: ${s.outOf}<br>STREAM POS: ${W ? 'W' : `${s.classPosition} of ${s.classOutOf}`}</td>
       <td>TOTAL MARKS: <b>${W || s.total == null ? '—' : Math.round(s.total)}</b></td>
       <td>MEAN SCORE: <b>${W || s.mean == null ? '—' : num(s.mean)}</b><br>GRADE: <b>${W ? 'W' : esc(s.grade)}</b></td>
       <td>AVERAGE POINTS: <b>${W || s.meanPoints == null ? '—' : num(s.meanPoints)}</b></td></tr>
   <tr><td>TARGET PURSUIT: ${s.target ? (s.target.met ? 'MET' : 'NOT MET') : '—'}</td><td>SUBJECTS DONE: ${s.subjectsDone}</td>
       <td colspan="2">GENERAL REMARKS: <b>${W ? esc(s.reason || 'No results') : esc(s.remark || '')}</b></td></tr>
  </table>
  <div class="ti" style="margin-top:6px">TERMLY ANALYSIS</div>
  <table class="cn"><tr><th rowspan="2">SUBJECT</th><th colspan="2">MARKS<br>${esc(exam?.name || '')}</th><th rowspan="2">GRADE</th><th rowspan="2">POINTS</th><th rowspan="2">POSITION PER SUBJECT</th><th rowspan="2">TEACHER'S REMARKS</th><th rowspan="2">INITIAL</th></tr><tr><th>CODE</th><th>OUT OF 100%</th></tr>${rows}</table>
  ${excluded ? '<div class="ln" style="font-size:9.5px">Faded subjects were not counted in the total (Mathematics plus the best six other subjects count).</div>' : ''}
  <div class="ln"><b>Comments:</b> ${card.teacherComment ? `<u>${esc(card.teacherComment)}</u>` : '<span class="bl" style="min-width:75%"></span>'}</div>
  <div class="ln"><b>Class Teacher:</b> <u>${esc(o.classTeacher || card.classTeacher?.name || '')}</u></div>
  <div class="ln">Character: <u>${esc(o.character)}</u> Attendance: <u>${esc(o.attendance)}</u> Co-curricular: <u>${esc(o.coCurricular)}</u></div>
  <div class="ln">Performance: <span class="bl" style="min-width:60%"></span></div>
  <div class="ln">Date: ${esc(o.date)} &nbsp; Class Teacher's Signature: <span class="bl"></span></div>
  <div class="ln"><b>Principal/D. Principal's remarks:</b> <u>${esc(W ? '' : principalNote(s))}</u></div>
  <div class="ln"><b>Principal:</b> <u>${esc(o.principal)}</u> &nbsp; Date: ${esc(o.date)} &nbsp; Principal's Signature: <span class="bl"></span></div>
  <div class="ln">Report Seen By Parent/Guardian: <span class="bl"></span> Signature: <span class="bl" style="min-width:90px"></span> Date: <span class="bl" style="min-width:70px"></span></div>
  <div class="ln">Next term begins on: <u>${esc(o.nextTerm)}</u> by 2pm</div></div>`;
}

// ---------- Modern: the on-screen card (parents on a phone) ----------
export function modernCard(card, exam, o = cardOptions(), trend = []) {
  const { school, student, lines, summary: s } = card;
  const W = !s.eligible, taken = lines.filter((l) => l.taken);
  const bars = taken.map((l) => ({ label: l.name, value: l.percent ?? (l.points / s.topPoints) * 100, color: 'var(--c1)' }));
  const sub = taken.map((l) => `<tr class="${l.isCounted === false ? 'mut' : ''}"><td>${esc(l.name)}</td><td>${l.percent != null ? Math.round(l.percent) + '%' : '—'}</td><td><span class="pill">${esc(l.grade)}</span></td><td>${l.points}</td><td>${l.position ?? '—'}</td><td class="mut">${esc(l.remark || '')}</td></tr>`).join('');
  const tr = trend.length > 1 ? `<div class="card flat" style="margin-top:14px"><div class="b" style="margin-bottom:8px">Progress across exams</div>${lineChart(trend.map((t) => t.exam.name), [{ name: 'Mean', values: trend.map((t) => (t.mean != null ? Math.round(t.mean * 10) / 10 : null)) }], { unit: '%', title: 'Mean score across exams' })}</div>` : '';
  const kpi = (l, v, sub2) => `<div class="card flat stat"><span class="l">${l}</span><span class="n">${v}</span>${sub2 ? `<span class="sm mut">${sub2}</span>` : ''}</div>`;
  return `<div class="mc">
   <div class="mc-head"><div><h2>${esc(school.name)}</h2><div class="mut sm">${esc(exam?.name || '')}${exam?.academic_year ? ' · ' + esc(exam.academic_year) : ''}</div></div>
     <div class="right"><div class="b">${esc(student.name)}</div><div class="mut sm">${esc(student.className)} · Adm ${esc(student.admissionNo)}</div></div></div>
   ${W ? `<div class="notice">No overall result this time: ${esc(s.reason || '')}</div>` : `
   <div class="grid g4">${kpi('Position', `${s.position}<span class="sm mut"> / ${s.outOf}</span>`, s.classPosition ? `Class: ${s.classPosition} of ${s.classOutOf}` : '')}
     ${kpi('Mean score', s.mean != null ? num(s.mean) + '%' : '—')}${kpi('Overall grade', esc(s.grade || '—'), esc(s.remark || ''))}${kpi('Points', num(s.meanPoints), `${s.totalPoints} total`)}</div>`}
   <div class="card flat" style="margin-top:14px"><div class="b" style="margin-bottom:6px">Subjects</div>${barChart(bars, { max: 100, unit: '%', title: 'Subject scores', height: 190 })}</div>
   <div class="card flat pad0" style="margin-top:14px"><div class="ov"><table><thead><tr><th>Subject</th><th>Score</th><th>Grade</th><th>Pts</th><th>Position</th><th>Remark</th></tr></thead><tbody>${sub}</tbody></table></div></div>
   ${tr}
   ${card.teacherComment ? `<div class="card flat" style="margin-top:14px"><div class="b">Teacher's comment</div><p>${esc(card.teacherComment)}</p></div>` : ''}
   ${card.classTeacher ? `<div class="sm mut" style="margin-top:12px">Class teacher: ${esc(card.classTeacher.name)}${card.classTeacher.phone ? ' · ' + esc(card.classTeacher.phone) : ''}</div>` : ''}
  </div>`;
}

export const renderCard = (card, exam, o, trend) => (card.template === 'modern' ? modernCard(card, exam, o, trend) : classicCard(card, exam, o));

// ---------- printing & saving ----------
// Print: put the cards in a print-only root and call the browser's print box,
// where the user can pick a printer or "Save as PDF".
export function printHtml(html) {
  let root = document.getElementById('print-root');
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.append(root); }
  root.innerHTML = html;
  const style = document.getElementById('print-only-style') || Object.assign(document.createElement('style'), { id: 'print-only-style' });
  style.textContent = '#print-root{display:none}@media print{body>*:not(#print-root){display:none!important}#print-root{display:block}}';
  document.head.append(style);
  setTimeout(() => window.print(), 50);
}

async function inlineCss() { try { return await (await fetch('/css/app.css')).text(); } catch { return ''; } }
export function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
// A standalone .html of all the cards that opens the print box when opened.
export async function downloadPrintable(html, name) {
  const css = await inlineCss();
  download(`${name}.html`, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(name)}</title><style>${css}body{background:#fff}</style></head><body>${html}<script>onload=()=>setTimeout(()=>print(),500)<\/script></body></html>`, 'text/html');
}
let pdfLib = null;
function loadPdfLib() {
  if (window.html2pdf) return Promise.resolve();
  pdfLib ||= new Promise((res, rej) => {
    const s = Object.assign(document.createElement('script'), { src: 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js', onload: res, onerror: () => rej(new Error('Could not load the PDF tool. Check your connection, or use Print and choose "Save as PDF".')) });
    document.head.append(s);
  });
  return pdfLib;
}
export async function downloadPdf(html, name) {
  await loadPdfLib();
  const w = document.createElement('div'); w.style.cssText = 'position:fixed;left:-10000px;top:0;width:718px;background:#fff';
  w.innerHTML = `<style>.rc,.mc{margin:0!important;border:0!important;box-shadow:none!important}</style>${html}`; document.body.append(w);
  try {
    await window.html2pdf().set({ margin: 8, image: { type: 'jpeg', quality: 0.92 }, html2canvas: { scale: 1.5, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['css'], after: ['.rc', '.mc'] } }).from(w).save(`${name}.pdf`);
  } finally { w.remove(); }
}
export const PDF_LIMIT = 60;
