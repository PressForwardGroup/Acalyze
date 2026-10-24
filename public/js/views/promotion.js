import { api } from '../api.js';
import { esc, $, $$, num, toast, run, modal, stat, initials, bandPill, BAND_CUTS } from '../ui.js';

// Year-end promotion: pick a class, check what each student should do, review, then move them in one step.
const opt = (rows, val, label, sel) => rows.map((r) => `<option value="${esc(val(r))}" ${val(r) === sel ? 'selected' : ''}>${esc(label(r))}</option>`).join('');
const OUT = [['promote', 'Promote'], ['repeat', 'Repeat the class'], ['leave', 'Leaves the school']];

// "Form 3" with stream "East" -> the class called Form 4 with the same stream, if the school has one.
function nextClass(cls, from) {
  const m = String(from?.grade || '').match(/^(.*?)(\d+)\s*$/);
  if (!m) return '';
  const want = `${m[1]}${+m[2] + 1}`.trim().toLowerCase();
  const same = cls.filter((c) => String(c.grade || '').trim().toLowerCase() === want);
  return (same.find((c) => (c.stream || '') === (from.stream || '')) || same[0])?.id || '';
}

async function promotion(el, ctx) {
  const [cls, roster, exams, ov] = await Promise.all([api('/classes'), api('/students'), api('/exams'), api('/analytics/overview').catch(() => null)]);
  if (cls.length < 1) { el.innerHTML = `${ctx.bar('Promotion')}<div class="card empty">Add your classes first.</div>`; return; }
  const name = Object.fromEntries(cls.map((c) => [c.id, c.name]));
  let st = { from: cls[0].id, to: '', exam: ov?.latestExam?.id || exams[0]?.id || '', pass: BAND_CUTS[3], rows: [], pick: {}, done: null };
  st.to = nextClass(cls, cls[0]);

  async function load() {
    const inClass = roster.filter((s) => s.class_id === st.from && s.status !== 'left');
    const means = new Map();
    if (st.exam) {
      const d = await api(`/results?examId=${encodeURIComponent(st.exam)}&classId=${encodeURIComponent(st.from)}`).catch(() => null);
      d?.rows.forEach((r) => { const top = d.scheme === 'cbc' ? 8 : 12; means.set(r.student.id, r.mean != null ? +r.mean : r.meanPoints != null ? (r.meanPoints / top) * 100 : null); });
    }
    st.rows = inClass.map((s) => ({ s, mean: means.get(s.id) ?? null }));
    st.pick = {};
  }
  const suggest = (r) => (r.mean != null && r.mean < st.pass ? 'repeat' : 'promote');
  const outcome = (r) => st.pick[r.s.id] || suggest(r);

  function draw() {
    const counts = { promote: 0, repeat: 0, leave: 0 }; st.rows.forEach((r) => counts[outcome(r)]++);
    const noMarks = st.rows.filter((r) => r.mean == null).length;
    const sameClass = counts.promote > 0 && st.to === st.from, noTo = counts.promote > 0 && !st.to;
    el.innerHTML = `${ctx.bar('Year-end promotion', 'Move a class up at the end of the year. You review everything before it happens.')}
    <div class="notice" style="margin-bottom:16px"><b>Print this class's report cards first.</b> Report cards follow the student's current class, so after promotion they belong to the new class. <a href="#/app/reportcards">Open report cards</a></div>
    <div class="card"><div class="form-grid">
      <div><label class="f" for="pf">From class</label><select class="i" id="pf">${opt(cls, (c) => c.id, (c) => c.name, st.from)}</select></div>
      <div><label class="f" for="pt">Promote into</label><select class="i" id="pt"><option value="">— choose —</option>${opt(cls, (c) => c.id, (c) => c.name, st.to)}</select></div>
      <div><label class="f" for="pe">Marks to base this on</label><select class="i" id="pe">${exams.length ? opt(exams, (e) => e.id, (e) => e.name + (e.academic_year ? ' · ' + e.academic_year : ''), st.exam) : '<option value="">No exams yet</option>'}</select></div>
      <div><label class="f" for="pp">Pass mark (%)</label><input class="i" id="pp" type="number" min="0" max="100" value="${st.pass}"><div class="sm mut">Students below this are suggested to repeat.</div></div></div></div>
    <div class="grid g4" style="margin-top:16px">${stat('Promote', counts.promote, { tone: 'b4', sub: `into ${name[st.to] || '…'}` })}${stat('Repeat the class', counts.repeat, { tone: counts.repeat ? 'b2' : '', sub: `stay in ${name[st.from]}` })}${stat('Leave the school', counts.leave, { sub: 'record is kept' })}${stat('No marks yet', noMarks, { tone: noMarks ? 'b3' : 'b5', sub: noMarks ? 'check these first' : 'all have marks' })}</div>
    <div class="card pad0" style="margin-top:16px">${st.rows.length ? `<div class="ov"><table><thead><tr><th>Student</th><th>Mean</th><th>Suggested</th><th>Outcome</th></tr></thead><tbody>${st.rows.map((r) => `<tr><td><div class="who"><span class="ava b0">${esc(initials(r.s.full_name))}</span><div><b>${esc(r.s.full_name)}</b><div class="mut sm">Adm ${esc(r.s.school_id_number)}</div></div></div></td>
      <td>${r.mean != null ? `<b>${num(r.mean)}%</b> ${bandPill(r.mean)}` : '<span class="pill">No marks</span>'}</td><td class="mut">${suggest(r) === 'repeat' ? 'Repeat' : 'Promote'}</td>
      <td><select class="i" data-o="${r.s.id}" style="width:auto;min-width:170px" aria-label="Outcome for ${esc(r.s.full_name)}">${OUT.map(([k, l]) => `<option value="${k}" ${outcome(r) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">There are no students in this class.</div>'}</div>
    ${sameClass ? '<div class="notice bad" style="margin-top:12px">Pick a different class to promote into.</div>' : noTo ? '<div class="notice" style="margin-top:12px">Choose the class to promote into.</div>' : ''}
    <div class="row" style="margin-top:16px;justify-content:flex-end"><a class="btn" href="#/app/reportcards">Print report cards</a><button class="btn primary" id="review" ${!st.rows.length || sameClass || noTo ? 'disabled' : ''}>Review and promote</button></div>`;

    $('#pf', el).onchange = async (e) => { st.from = e.target.value; st.to = nextClass(cls, cls.find((c) => c.id === st.from)); await load(); draw(); };
    $('#pt', el).onchange = (e) => { st.to = e.target.value; draw(); };
    $('#pe', el).onchange = async (e) => { st.exam = e.target.value; await load(); draw(); };
    $('#pp', el).onchange = (e) => { st.pass = Math.max(0, Math.min(100, +e.target.value || 0)); draw(); };
    $$('[data-o]', el).forEach((s) => (s.onchange = () => { st.pick[s.dataset.o] = s.value; draw(); }));
    $('#review', el).onclick = () => modal(`<h3>Review before you promote</h3>
      <p><b>${counts.promote}</b> will move from ${esc(name[st.from])} to <b>${esc(name[st.to] || '—')}</b>.<br><b>${counts.repeat}</b> will stay in ${esc(name[st.from])}.<br><b>${counts.leave}</b> will be marked as having left. Their records and marks are kept.</p>
      <p class="sm mut">You can undo this straight afterwards from the next screen.</p>
      <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Go back</button><button class="btn primary" id="go">Promote now</button></div>`, {
      onMount: (m, close) => { $('#go', m).onclick = (e) => run(e.currentTarget, async () => {
        const r = await api('/student-transfer/promote', { method: 'POST', body: { fromClassId: st.from, toClassId: st.to || undefined, outcomes: st.rows.map((x) => ({ studentId: x.s.id, outcome: outcome(x) })) } });
        close(); st.done = { ...r, from: st.from, to: st.to }; finished();
      }); } });
  }

  function finished() {
    const d = st.done;
    el.innerHTML = `${ctx.bar('Year-end promotion')}
    <div class="card" style="text-align:center;padding:36px 20px"><div class="ava lg b5" style="margin:0 auto 12px">✓</div><h2>Done</h2>
      <p class="mut" style="margin:8px 0 18px">${d.promoted} moved to ${esc(name[d.to] || '')} · ${d.repeated} stayed in ${esc(name[d.from])} · ${d.left} marked as left</p>
      <div class="row" style="justify-content:center"><button class="btn" id="undo">Undo this promotion</button><button class="btn primary" id="again">Promote another class</button><a class="btn" href="#/app/students">See students</a></div></div>`;
    $('#again', el).onclick = () => promotion(el, ctx);
    $('#undo', el).onclick = (e) => run(e.currentTarget, async () => {
      const r = await api('/student-transfer/promote/undo', { method: 'POST', body: d.undo });
      toast(`Put back: ${r.restored} moved back, ${r.reactivated} reactivated`, 'ok'); promotion(el, ctx);
    });
  }

  await load(); draw();
}

export const views = { promotion };
