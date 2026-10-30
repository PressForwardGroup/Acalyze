-- 1) Each school uses only some sections. Existing schools keep all three, so nothing changes for them.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS sections section[] NOT NULL DEFAULT '{PRIMARY,JUNIOR,SENIOR}';

-- 2) Short names people use for subjects ("Kisw", "SCIE&TECNO"), saved once, used everywhere.
CREATE TABLE IF NOT EXISTS subject_aliases (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  alias_key       text NOT NULL,                              -- normalised: upper case, letters and digits only
  alias_text      text NOT NULL,                              -- as the person wrote it
  subject_id      uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, alias_key)
);
