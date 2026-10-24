-- Waivers, bursaries and discounts (reduce what a student owes) and refunds (money returned to a parent).
-- Both need the principal's approval when the finance officer asks; only approved ones count.
CREATE TABLE IF NOT EXISTS fee_adjustments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year   text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('waiver','bursary','discount','sibling','staff_child','other')),
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  reason          text NOT NULL,
  sponsor         text,
  status          text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected','cancelled')),
  created_by_id   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fee_adj_student ON fee_adjustments (student_id, academic_year);

CREATE TABLE IF NOT EXISTS fee_refunds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year   text NOT NULL,
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  method          text NOT NULL CHECK (method IN ('cash','mpesa','bank','cheque','other')),
  reference       text,
  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected','cancelled')),
  refunded_on     date NOT NULL DEFAULT current_date,
  created_by_id   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fee_refunds_student ON fee_refunds (student_id, academic_year);
