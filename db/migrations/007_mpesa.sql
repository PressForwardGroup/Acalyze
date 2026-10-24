-- M-Pesa: each school's own Paybill settings (keys stored encrypted) and every M-Pesa transaction that reaches the system.
CREATE TABLE IF NOT EXISTS mpesa_settings (
  organization_id     uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  env                 text NOT NULL DEFAULT 'sandbox' CHECK (env IN ('sandbox','production')),
  shortcode           text NOT NULL,
  consumer_key_enc    text,
  consumer_secret_enc text,
  passkey_enc         text,
  hook_token          text NOT NULL,
  enabled             boolean NOT NULL DEFAULT false,
  urls_registered_at  timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mpesa_transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source              text NOT NULL CHECK (source IN ('stk','c2b','claim')),
  status              text NOT NULL CHECK (status IN ('pending','paid','unmatched','failed','cancelled','ignored','claimed','rejected')),
  checkout_request_id text,
  trans_id            text,
  amount              numeric(12,2),
  phone               text,
  account_ref         text,
  student_id          uuid REFERENCES students(id) ON DELETE SET NULL,
  payment_id          uuid REFERENCES fee_payments(id) ON DELETE SET NULL,
  result_desc         text,
  note                text,
  raw                 jsonb,
  created_by_id       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);
-- The same M-Pesa receipt code can never be posted twice, even if Safaricom sends a message twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mpesa_trans ON mpesa_transactions (organization_id, trans_id) WHERE trans_id IS NOT NULL AND source <> 'claim';
CREATE UNIQUE INDEX IF NOT EXISTS uq_mpesa_checkout ON mpesa_transactions (checkout_request_id) WHERE checkout_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mpesa_org_status ON mpesa_transactions (organization_id, status, created_at DESC);
