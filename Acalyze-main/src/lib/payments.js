import { query } from './db.js';

// Records a payment and gives it the school's next receipt number. Used for payments typed in by hand
// and for payments that arrive from M-Pesa, so both get numbered the same way.
export async function insertPayment({ org, studentId, academicYear, amount, method, reference = null, paidOn = null, note = null, recordedById = null }) {
  const code = (await query(`SELECT org_code FROM organizations WHERE id = $1`, [org])).rows[0].org_code;
  const { rows } = await query(
    `INSERT INTO fee_payments (organization_id, student_id, academic_year, amount, method, reference, paid_on, receipt_no, note, recorded_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, current_date), $8::text || '-' || lpad(nextval('fee_receipt_seq')::text, 6, '0'), $9, $10)
     RETURNING id, receipt_no, amount::float AS amount, method, reference, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, academic_year`,
    [org, studentId, String(academicYear || new Date().getFullYear()).slice(0, 10), amount, method, reference ? String(reference).trim().slice(0, 60) : null, paidOn, code, note ? String(note).trim().slice(0, 200) : null, recordedById]);
  return rows[0];
}
