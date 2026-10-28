-- Foundation for school roles, modules, the audit log, approvals and "sign out everywhere".
-- Staff accounts live in admins: role_kind says which kind (admin/deputy, principal, finance officer).
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role_kind text NOT NULL DEFAULT 'admin' CHECK (role_kind IN ('admin','principal','finance'));
ALTER TABLE admins ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Which modules a school has, chosen by the platform admin. NULL means "follow the plan" (as before).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS modules jsonb;

CREATE TABLE IF NOT EXISTS audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  area            text NOT NULL,
  action          text NOT NULL,
  entity          text,
  entity_id       text,
  actor_role      text,
  actor_id        text,
  detail          jsonb,
  ip              text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_org_time ON audit_log (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS approval_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind               text NOT NULL,
  title              text NOT NULL,
  amount             numeric(14,2),
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by_id    text NOT NULL,
  requested_by_role  text,
  decided_by_id      text,
  decided_at         timestamptz,
  decision_note      text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approvals_org_status ON approval_requests (organization_id, status);

-- When someone chooses "sign out everywhere", tokens issued before valid_after stop working.
CREATE TABLE IF NOT EXISTS session_resets (
  user_id     text PRIMARY KEY,
  valid_after timestamptz NOT NULL
);
