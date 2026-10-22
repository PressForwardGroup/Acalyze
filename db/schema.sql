-- Acalyze database schema
-- Built on MOHI's original schema, with the multi-tenant layer MOHI never
-- needed (it only ever isolated branches of ONE organization). Here,
-- "organizations" are unrelated paying client schools; "centers" are
-- campuses/branches WITHIN one organization (most orgs will have exactly one).
--
-- The isolation guarantee is now two-layered:
--   1. Every org-scoped table carries organization_id; every query filters
--      by req.auth.organizationId from the verified JWT.
--   2. Within an org, center_id further scopes campus-level data (classes,
--      teachers, students) but is NEVER the auth boundary by itself —
--      organization_id is, so two unrelated schools can never collide.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE section AS ENUM ('PRIMARY', 'JUNIOR', 'SENIOR');
CREATE TYPE grading_scheme AS ENUM ('cbc', '844');
CREATE TYPE edit_request_type AS ENUM ('STUDENT_NAME', 'STUDENT_ID', 'MARK');
CREATE TYPE edit_request_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE org_status AS ENUM ('pending', 'active', 'suspended');
CREATE TYPE report_card_template AS ENUM ('classic', 'modern');
CREATE TYPE billing_cycle AS ENUM ('annual', 'termly');

-- Which migrations have been applied (see db/migrations/README.md). Version 1 is this file.
CREATE TABLE schema_migrations (
  version     int PRIMARY KEY,
  name        text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- PLATFORM LAYER (new — this is what MOHI never had) ----------

-- Inbound public registrations, before an org exists. A row here becomes
-- an `organizations` row only once a platform_admin approves it.
CREATE TABLE school_registrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_name       text NOT NULL,
  location          text,
  contact_name      text,
  contact_email     text NOT NULL,
  contact_phone     text,
  system_used       text,                         -- "8-4-4", "CBC", "both" — free text from the form
  approx_students   int,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by_id    uuid,                          -- references platform_admins(id), set on approve/reject
  reviewed_at       timestamptz,
  organization_id   uuid,                          -- set once approved and provisioned
  submitted_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per paying client school. This is the tenant boundary.
CREATE TABLE organizations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  slug                  text NOT NULL UNIQUE,       -- lowercase, used in admin emails: admin@<slug>.acalyze.app
  org_code              text NOT NULL UNIQUE,       -- short code used as the student-ID prefix, e.g. "RVS"
  status                org_status NOT NULL DEFAULT 'pending',
  default_grading_scheme grading_scheme NOT NULL DEFAULT 'cbc',
  report_card_template  report_card_template NOT NULL DEFAULT 'classic',
  -- Pricing: set by the platform admin once agreed with the school (see Billing mockup).
  modules               jsonb,                      -- chosen modules; NULL = follow the plan
  plan_name             text,                       -- "Analytics" | "Analytics + Parents" | "Full Suite" | "Custom"
  rate_per_student       numeric(10,2),
  billing_cycle          billing_cycle NOT NULL DEFAULT 'annual',
  -- Branding, used on report cards and the school's own login screen.
  motto                 text,
  logo_url              text,
  -- Support contact shown to this school's parents (defaults to the school's registration contact).
  support_email         text,
  support_phone         text,
  support_note          text,
  pay_instructions      text,                       -- how parents pay (shown on their fees page), e.g. Paybill and account
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Platform-level staff (you / Acalyze team). Separate from any org's admins —
-- this role does NOT automatically see inside an org's day-to-day data; it
-- approves registrations, manages organizations and billing, full stop.
CREATE TABLE platform_admins (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name      text NOT NULL,
  email          text NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE school_registrations
  ADD CONSTRAINT fk_registration_reviewer FOREIGN KEY (reviewed_by_id) REFERENCES platform_admins(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_registration_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- ---------- ORG STRUCTURE ----------

CREATE TABLE centers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,                   -- e.g. "Main Campus"
  center_code     text NOT NULL,
  location        text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, center_code)
);
CREATE INDEX idx_centers_org ON centers(organization_id);

-- ---------- PEOPLE ----------

-- School-side admins, scoped to ONE organization (they see every center in
-- their own org, never another org's data).
CREATE TABLE admins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name       text NOT NULL,
  email           text NOT NULL UNIQUE,
  password_hash   text NOT NULL,
  -- Which kind of staff account: school admin / deputy, principal (head, owner), or finance officer.
  role_kind       text NOT NULL DEFAULT 'admin' CHECK (role_kind IN ('admin','principal','finance')),
  title           text,
  active          boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_admins_org ON admins(organization_id);

CREATE TABLE teachers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  center_id       uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  full_name       text NOT NULL,
  phone           text,
  bio             text,
  section         section NOT NULL,
  email           text,                              -- each teacher signs in individually, so marks are traceable to a person
  password_hash   text,
  must_change_password boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_teachers_email ON teachers (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX idx_teachers_org ON teachers(organization_id);
CREATE INDEX idx_teachers_center ON teachers(center_id);

-- Parents — NEW. Replaces student login entirely: students never sign in.
-- Phone number is the login identifier, unique per organization (not
-- globally — the same phone could belong to a parent at two unrelated
-- schools, each with its own separate account and password).
CREATE TABLE parents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name       text,
  phone           text NOT NULL,
  password_hash   text NOT NULL,
  password_changed boolean NOT NULL DEFAULT false, -- same first-login reset pattern MOHI used for students
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, phone)
);
CREATE INDEX idx_parents_org ON parents(organization_id);


-- ---------- SCHOOL STRUCTURE ----------

CREATE TABLE classes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  center_id         uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name              text NOT NULL,                 -- "Grade 8 Green", "Form 3 West"
  grade             text NOT NULL,                 -- "Grade 8", "Form 3"
  stream            text,
  section           section NOT NULL,
  grading_scheme    grading_scheme NOT NULL,        -- CBC classes and 8-4-4 classes can coexist in one org
  academic_year     text,
  class_teacher_id  uuid REFERENCES teachers(id) ON DELETE SET NULL,
  UNIQUE (center_id, name)
);
CREATE INDEX idx_classes_org ON classes(organization_id);
CREATE INDEX idx_classes_center ON classes(center_id);

CREATE TABLE subjects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  center_id       uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name            text NOT NULL,
  code            text,                            -- e.g. "121" — matches the physical report form's subject code
  section         section,
  is_science      boolean NOT NULL DEFAULT false,   -- 8-4-4 uses a stricter grade boundary for sciences
  UNIQUE (center_id, name)
);
CREATE INDEX idx_subjects_org ON subjects(organization_id);

CREATE TABLE class_teachers (
  class_id    uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id  uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, teacher_id)
);

CREATE TABLE teacher_subjects (
  teacher_id  uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  subject_id  uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, subject_id)
);

CREATE TABLE teacher_assignments (                -- exact class + subject pairs a teacher is responsible for
  teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id   uuid NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, class_id, subject_id)
);

CREATE TABLE students (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  center_id         uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  school_id_number  text NOT NULL,                 -- login no longer applies to students (parents log in instead);
                                                     -- this stays as their admission/ID number for records & transfers
  full_name         text NOT NULL,
  class_id          uuid REFERENCES classes(id) ON DELETE SET NULL,
  date_of_birth     date,
  gender            text,
  enrollment_date   date NOT NULL DEFAULT current_date,
  status            text NOT NULL DEFAULT 'active',
  boarding          text NOT NULL DEFAULT 'day' CHECK (boarding IN ('day','boarding')),   -- day scholar or boarder (fees can differ)
  kcpe_marks        int,                            -- 8-4-4 target-tracking input, optional
  UNIQUE (organization_id, school_id_number)
);
CREATE INDEX idx_students_org ON students(organization_id);
CREATE INDEX idx_students_center ON students(center_id);
CREATE INDEX idx_students_class ON students(class_id);

CREATE TABLE parent_students (                     -- multi-child households
  parent_id   uuid NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (parent_id, student_id)
);


-- Subjects always shown on a report card, even with no mark entered yet.
CREATE TABLE main_subjects (
  subject_id      uuid PRIMARY KEY REFERENCES subjects(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
);

-- ---------- EXAMS & RESULTS ----------

CREATE TABLE exams (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  center_id       uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name            text NOT NULL,
  term            text,
  academic_year   text,
  opens_on        text,
  closes_on       text,
  newsletter      text,
  is_published    boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_exams_org ON exams(organization_id);
CREATE INDEX idx_exams_center ON exams(center_id);

-- Generalized to hold BOTH CBC (sublevel like "EE1") and 8-4-4 (letter like
-- "A", "C+") grades in one scheme-agnostic column, so one report-card
-- renderer can read either without knowing which scheme produced it.
CREATE TABLE marks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id        uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id     uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id     uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  grade          text NOT NULL,                    -- "EE1".."BE2" (CBC) or "A".."E" (8-4-4)
  points         int NOT NULL,                      -- 8..1 (CBC) or 12..1 (8-4-4)
  percent        numeric(5,2),                       -- raw % after "out of" scale conversion
  is_counted     boolean NOT NULL DEFAULT true,       -- false = entered but excluded from mean/rank
                                                       -- (8-4-4's "Mathematics + best 6 of the rest" rule)
  entered_by_id  uuid REFERENCES teachers(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id, subject_id)
);
CREATE INDEX idx_marks_exam ON marks(exam_id);
CREATE INDEX idx_marks_student ON marks(student_id);

CREATE TABLE remarks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id     uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  text        text NOT NULL,
  teacher_id  uuid REFERENCES teachers(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id)
);

-- Per-student eligibility flag for an exam — the 8-4-4/CBC "W, no results"
-- case (fewer than the required subjects sat). Computed, but worth storing
-- so report cards and rankings agree without recomputing every read.
CREATE TABLE result_status (
  exam_id       uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  is_eligible   boolean NOT NULL DEFAULT true,
  reason        text,                                -- e.g. "5 subjects done (needs at least 7)"
  PRIMARY KEY (exam_id, student_id)
);

-- ---------- APPROVAL WORKFLOW ----------

CREATE TABLE edit_requests (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type                     edit_request_type NOT NULL,
  label                    text NOT NULL,
  old_value                text NOT NULL,
  new_value                text NOT NULL,
  status                   edit_request_status NOT NULL DEFAULT 'PENDING',
  requested_by_teacher_id  uuid REFERENCES teachers(id) ON DELETE SET NULL,
  student_id               uuid REFERENCES students(id) ON DELETE CASCADE,
  extra_json               jsonb,
  resolved_by_admin_id     uuid REFERENCES admins(id) ON DELETE SET NULL,
  requested_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at              timestamptz
);
CREATE INDEX idx_edit_requests_org ON edit_requests(organization_id);
CREATE INDEX idx_edit_requests_status ON edit_requests(status);

-- "I forgot my password" requests. Parents and teachers go to their school
-- admin; school admins go to the platform admin. person_id points at the
-- parents / teachers / admins row depending on `kind`.
CREATE TABLE password_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('parent','teacher','admin')),
  person_id       uuid NOT NULL,
  identifier      text NOT NULL,                     -- phone (parent) or email (teacher/admin)
  full_name       text NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DONE')),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);
CREATE INDEX idx_password_requests_org ON password_requests(organization_id);

-- ---------- PARENT-TEACHER CHAT ----------
-- One conversation per (parent, teacher) pair; student_id optionally says which child it is about.
CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id       uuid NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  teacher_id      uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  student_id      uuid REFERENCES students(id) ON DELETE SET NULL,
  sender          text NOT NULL CHECK (sender IN ('parent','teacher')),
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz
);
CREATE INDEX idx_messages_pair ON messages(parent_id, teacher_id, created_at);
CREATE INDEX idx_messages_org ON messages(organization_id);

-- ---------- ATTENDANCE ----------
-- One row per student per day. Recorded by the teacher; parents see their own child's.
CREATE TABLE attendance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id        uuid REFERENCES classes(id) ON DELETE SET NULL,
  day             date NOT NULL,
  status          text NOT NULL CHECK (status IN ('present','absent','late','excused')),
  recorded_by_id  uuid REFERENCES teachers(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, day)
);
CREATE INDEX idx_attendance_org_day ON attendance(organization_id, day);
CREATE INDEX idx_attendance_class_day ON attendance(class_id, day);

-- ---------- SCHOOL FEES ----------
-- What the school charges (per year, optionally per term, for everyone or one grade)...
CREATE TABLE fee_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,                        -- "Tuition", "Lunch", "Transport"
  amount          numeric(12,2) NOT NULL CHECK (amount >= 0),
  academic_year   text NOT NULL,
  term            text,                                 -- null = the whole year
  grade           text,                                 -- legacy single grade; null = every student
  vote_head       text,                                 -- "Tuition", "Boarding", "Transport"... for reports
  grades          text[],                               -- only these grades, e.g. {Grade 1,Grade 2,Grade 3}; null/empty = all grades
  audience        text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','day','boarding','optional')),   -- optional = only students assigned to it
  due_date        date,
  note            text,                                 -- shown to parents, e.g. "Trip to Naivasha, pay by 20 Nov"
  published_at    timestamptz,                          -- null = draft: not charged and not visible to parents yet
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE student_fee_items (                        -- who takes an optional charge (transport route, lunch, trip)
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  fee_item_id uuid NOT NULL REFERENCES fee_items(id) ON DELETE CASCADE,
  PRIMARY KEY (student_id, fee_item_id)
);
CREATE INDEX idx_fee_items_org ON fee_items(organization_id, academic_year);

-- ...and what has been paid. Balance = charges that apply to the student - payments, per year.
CREATE SEQUENCE fee_receipt_seq;
CREATE TABLE fee_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year   text NOT NULL,
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  method          text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','mpesa','bank','other')),
  reference       text,                                 -- e.g. the M-Pesa code
  paid_on         date NOT NULL DEFAULT current_date,
  receipt_no      text NOT NULL,
  note            text,
  recorded_by_id  uuid REFERENCES admins(id) ON DELETE SET NULL,
  reversed_at     timestamptz,                          -- set when a mistaken payment is reversed (never deleted)
  reversed_by_id  uuid REFERENCES admins(id) ON DELETE SET NULL,
  reversal_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, receipt_no)
);
CREATE INDEX idx_fee_payments_student ON fee_payments(student_id, academic_year);
CREATE INDEX idx_fee_payments_org ON fee_payments(organization_id, paid_on);

-- ---------- SCHOOL CALENDAR ----------
CREATE TABLE events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title           text NOT NULL,
  description     text,
  starts_on       date NOT NULL,
  ends_on         date,
  kind            text NOT NULL DEFAULT 'event' CHECK (kind IN ('term','exam','holiday','meeting','event')),
  audience        text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','staff')),   -- 'staff' is hidden from parents
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_org ON events(organization_id, starts_on);

-- ---------- BILLING (records only — Phase 5/Daraja wiring comes later) ----------

CREATE TABLE invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_label    text NOT NULL,                     -- "2026", "Term 2 2026"
  plan_name       text NOT NULL,
  student_count   int NOT NULL,
  rate_per_student numeric(10,2) NOT NULL,
  amount          numeric(12,2) NOT NULL,
  due_date        date,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue')),
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoices_org ON invoices(organization_id);

-- Website bookings (demo / meeting requests). Also in db/migrations/003_bookings.sql for existing databases.
CREATE TABLE bookings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('in_person','video','phone')),
  name        text NOT NULL,
  school      text,
  email       text NOT NULL,
  phone       text,
  message     text,
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','declined','done','cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bookings_one_per_slot ON bookings (starts_at) WHERE status IN ('new','confirmed');

-- Audit log, approvals and sign-out-everywhere. Also in db/migrations/004_roles_audit_approvals.sql for existing databases.
CREATE TABLE audit_log (
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
CREATE INDEX idx_audit_org_time ON audit_log (organization_id, created_at DESC);

CREATE TABLE approval_requests (
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
CREATE INDEX idx_approvals_org_status ON approval_requests (organization_id, status);

CREATE TABLE session_resets (
  user_id     text PRIMARY KEY,
  valid_after timestamptz NOT NULL
);
