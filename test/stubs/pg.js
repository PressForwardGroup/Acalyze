// In-memory stand-in for the Postgres driver. It answers only the SELECTs
// that lib/results.js and lib/analytics.js issue, by matching distinctive SQL
// fragments, and serves whatever fixtures a test puts on globalThis.__DB.
class Pool {
  async query(text, params = []) {
    const D = globalThis.__DB; const t = text.replace(/\s+/g, ' ');
    if (t.includes('FROM classes WHERE id = $1 AND organization_id')) return { rows: D.classes.filter((c) => c.id === params[0]) };
    if (t.includes('FROM classes WHERE organization_id = $1 AND center_id = $2 AND grade = $3')) return { rows: D.classes.filter((c) => c.grade === params[2]) };
    if (t.includes('FROM classes WHERE organization_id = $1 ORDER BY grade, name')) return { rows: D.classes };
    if (t.includes('FROM students WHERE class_id = ANY')) return { rows: D.students.filter((s) => params[0].includes(s.class_id)) };
    if (t.includes('FROM subjects')) return { rows: D.subjects };
    if (t.includes('FROM marks m')) return { rows: D.marks[params[0]] || [] };
    if (t.includes('FROM remarks r')) return { rows: [] };
    if (t.includes('created_at < (SELECT created_at FROM exams')) return { rows: D.prevExam ? [{ id: D.prevExam }] : [] };
    throw new Error('Unmatched SQL in stand-in: ' + t.slice(0, 90));
  }
}
export default { Pool };
