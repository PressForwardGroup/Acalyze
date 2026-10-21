-- Fee structure: vote heads, grade groups, day/boarding/optional charges, due dates, drafts that are published,
-- students who take optional services (transport, lunch, trips), and payment instructions for parents.
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
