-- Each school's support contact (shown to its parents) lives on the organization.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS support_email text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS support_phone text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS support_note  text;
