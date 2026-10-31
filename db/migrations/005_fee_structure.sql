-- Fee structure: vote heads, grade groups, day/boarding/optional charges, due dates, drafts that are published,
-- students who take optional services (transport, lunch, trips), and payment instructions for parents.

-- Databases created before the fees feature have no fee tables at all, so this migration creates them first
-- (a no-op where they already exist). Without this, the ALTERs below fail with: relation "fee_items" does not exist.
CREATE TABLE IF NOT EXISTS fee_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  amount          numeric(12,2) NOT NULL CHECK (amount >= 0),
  academic_year   text NOT NULL,
  term            text,
  grade           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fee_items_org ON fee_items(organization_id, academic_year);

CREATE SEQUENCE IF NOT EXISTS fee_receipt_seq;
CREATE TABLE IF NOT EXISTS fee_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year   text NOT NULL,
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  method          text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','mpesa','bank','other')),
  reference       text,
  paid_on         date NOT NULL DEFAULT current_date,
  receipt_no      text NOT NULL,
  note            text,
  recorded_by_id  uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, receipt_no)
);
CREATE INDEX IF NOT EXISTS idx_fee_payments_student ON fee_payments(student_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_fee_payments_org ON fee_payments(organization_id, paid_on);

ALTER TABLE fee_items ADD COLUMN IF NOT EXISTS vote_head text;
ALTER TABLE fee_items ADD COLUMN IF NOT EXISTS grades text[];
ALTER TABLE fee_items ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','day','boarding','optional'));
ALTER TABLE fee_items ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE fee_items ADD COLUMN IF NOT EXISTS note text;
-- Existing charges were already in use, so they start as published. Only new ones are drafts.
ALTER TABLE fee_items ADD COLUMN IF NOT EXISTS published_at timestamptz;
UPDATE fee_items SET published_at = created_at WHERE published_at IS NULL;

ALTER TABLE students ADD COLUMN IF NOT EXISTS boarding text NOT NULL DEFAULT 'day' CHECK (boarding IN ('day','boarding'));
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pay_instructions text;

CREATE TABLE IF NOT EXISTS student_fee_items (
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  fee_item_id uuid NOT NULL REFERENCES fee_items(id) ON DELETE CASCADE,
  PRIMARY KEY (student_id, fee_item_id)
);
