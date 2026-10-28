-- School accounts: money accounts (bank, cash, M-Pesa), vote heads with a yearly budget, payment vouchers,
-- other income, transfers between accounts, and imported bank statement lines for reconciliation.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS expense_approval_threshold numeric(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS cash_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('cash','bank','mpesa')),
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  opening_date    date NOT NULL DEFAULT current_date,
  receives        text[] NOT NULL DEFAULT '{}',
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expense_heads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS budget_lines (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year   text NOT NULL,
  head_id         uuid NOT NULL REFERENCES expense_heads(id) ON DELETE CASCADE,
  amount          numeric(14,2) NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (organization_id, academic_year, head_id)
);

CREATE SEQUENCE IF NOT EXISTS voucher_seq;

CREATE TABLE IF NOT EXISTS expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  voucher_no      text NOT NULL,
  head_id         uuid NOT NULL REFERENCES expense_heads(id),
  payee           text NOT NULL,
  description     text NOT NULL,
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  expense_date    date NOT NULL DEFAULT current_date,
  academic_year   text NOT NULL,
  invoice_ref     text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected','cancelled')),
  over_budget     boolean NOT NULL DEFAULT false,
  account_id      uuid REFERENCES cash_accounts(id),
  method          text CHECK (method IN ('cash','mpesa','bank','cheque','other')),
  reference       text,
  paid_on         date,
  requested_by_id text,
  paid_by_id      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, voucher_no)
);
CREATE INDEX IF NOT EXISTS idx_expenses_org_year ON expenses (organization_id, academic_year, status);

CREATE TABLE IF NOT EXISTS income_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES cash_accounts(id),
  kind            text NOT NULL CHECK (kind IN ('grant','donation','hire','sales','interest','other')),
  source          text NOT NULL,
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  received_on     date NOT NULL DEFAULT current_date,
  reference       text,
  note            text,
  reversed_at     timestamptz,
  reversal_reason text,
  created_by_id   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_account_id uuid NOT NULL REFERENCES cash_accounts(id),
  to_account_id   uuid NOT NULL REFERENCES cash_accounts(id),
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  transfer_date   date NOT NULL DEFAULT current_date,
  note            text,
  created_by_id   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (from_account_id <> to_account_id)
);

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES cash_accounts(id) ON DELETE CASCADE,
  line_date       date NOT NULL,
  description     text,
  reference       text,
  amount          numeric(14,2) NOT NULL,
  line_key        text NOT NULL,
  matched_ref     text,
  status          text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','matched','ignored')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, line_key)
);
