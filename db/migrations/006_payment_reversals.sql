-- Payments are never deleted. A mistaken payment is reversed: it stays on record with who, when and why,
-- and stops counting toward balances.
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS reversed_by_id uuid REFERENCES admins(id) ON DELETE SET NULL;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS reversal_reason text;
