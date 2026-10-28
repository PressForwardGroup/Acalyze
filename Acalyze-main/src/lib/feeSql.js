// "This charge applies to this student", as SQL. Used by balances, receipts, statements and the cleared list.
// Needs the aliases: fi = fee_items, s = students, c = the student's class (LEFT JOIN, may be empty).
// Mirrors chargeApplies() in fees.js; keep them identical.
export const CHARGE_APPLIES = `fi.published_at IS NOT NULL
  AND (
    (fi.audience <> 'optional'
      AND (fi.grade IS NULL OR fi.grade = c.grade)
      AND (fi.grades IS NULL OR cardinality(fi.grades) = 0 OR c.grade = ANY(fi.grades))
      AND (fi.audience = 'all' OR fi.audience = s.boarding))
    OR (fi.audience = 'optional' AND EXISTS (SELECT 1 FROM student_fee_items sf WHERE sf.fee_item_id = fi.id AND sf.student_id = s.id))
  )`;
